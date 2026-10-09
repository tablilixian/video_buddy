/**
 * CV-288：视觉风格库守卫（REQ-029 §十一）。
 *
 * 覆盖六条不变式 —— 前五条对应方案 §11.3 的 D8 写作规格（**规格不落成守卫就会被
 * 下次改文案的人悄悄破坏**），第六条是 D1「与成片风格预设两层并存」的名字防撞：
 *
 * 1. 长度 50–70 字（V1 实测：10–11 字短句**两轮一致地无效**，见 api-probe 01 vs 02）；
 * 2. 禁负向表述（`krea2-turbo-writing/SKILL.md:14`：cfg=1.0 时负向条件结构性失效）；
 * 3. 不与摄像机参数打架（焦段/光圈/景深归 `CAMERA_*`）；
 * 4. 不暗示画幅（`aspectRatio` 是 API 真参数）；
 * 5. id 唯一、分类非空、色板非空；
 * 6. **与 `style-presets.md` 的 11 条成片预设零重名**（D1 拍板：两表互不引用、名字
 *    也不能撞 —— 「东方神话视觉导演」已有，视觉风格再出一条「东方神话」就会迷惑）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NO_STYLE_ID,
  STYLE_CATEGORIES,
  VISUAL_STYLES,
  styleIdOfPrefix,
  stylePrefixOf,
  stylesInCategory,
  visualStyleOf,
} from '../lib/visual-styles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRESETS_MD = readFileSync(
  join(ROOT, 'skills', 'canvas-studio-creation', 'references', 'style-presets.md'),
  'utf-8',
)

/** 负向词：Krea2 cfg=1.0 下这类词结构性失效，约束必须写成正向。 */
const NEGATIVE = /不|无|避免|不要|禁止/
/** 摄像机领域词：风格写了会和摄像机弹层互相覆盖（D8 规格 5）。 */
const CAMERA_TERM = /\d+mm|f\/\d|景深|光圈|焦段/
/** 画幅暗示：`aspectRatio` 是 API 真参数，风格再暗示就打架（D8 规格 6）。 */
const ASPECT_TERM = /宽银幕|宽画幅|宽幅|画幅比例/

test('D8-1 每条风格描述 50–70 字', () => {
  for (const style of VISUAL_STYLES) {
    const n = style.prefix.length
    assert.ok(
      n >= 50 && n <= 70,
      `${style.name} 长度 ${n} 字，超出 50–70 区间（短前缀在 Krea2 上基本无效）`,
    )
  }
})

test('D8-2 无负向表述（cfg=1.0 下负向条件失效）', () => {
  for (const style of VISUAL_STYLES) {
    const hit = style.prefix.match(NEGATIVE)
    assert.equal(
      hit,
      null,
      `${style.name} 含负向词「${hit?.[0]}」——须改成正向表述`,
    )
  }
})

test('D8-3 不与摄像机参数打架（不写焦段/光圈/景深）', () => {
  for (const style of VISUAL_STYLES) {
    const hit = style.prefix.match(CAMERA_TERM)
    assert.equal(hit, null, `${style.name} 写了摄像机领域词「${hit?.[0]}」`)
  }
})

test('D8-4 不暗示画幅（aspectRatio 是 API 真参数）', () => {
  for (const style of VISUAL_STYLES) {
    const hit = style.prefix.match(ASPECT_TERM)
    assert.equal(hit, null, `${style.name} 暗示了画幅「${hit?.[0]}」`)
  }
})

test('D8-5 必含具体媒介技术名词（模型吃名词不吃风格名）', () => {
  // 风格名本身（"动漫插画风格"）信息量远低于媒介技术词（"黑色描边搭配平涂色块"）。
  // 这是**下限**而非穷举词表 —— 词表可以补，但判定意图不能松：只放行含具体名词的写法。
  const CONCRETE = /描边|平涂|色块|渗化|浓淡干湿|颗粒|刀痕|排线|留白|刺绣|轮廓光|体积雾|漏光|做旧|湿润|反光|纹理|微对比|滚降|高光|皮孔|绢本|宣纸/
  for (const style of VISUAL_STYLES) {
    assert.ok(
      CONCRETE.test(style.prefix),
      `${style.name} 没有具体媒介技术名词，只有风格名或形容词`,
    )
  }
})

test('D1-1 id 唯一、分类在枚举内、色板非空', () => {
  const ids = VISUAL_STYLES.map(s => s.id)
  assert.equal(new Set(ids).size, ids.length, '有重复 id')
  for (const style of VISUAL_STYLES) {
    assert.ok(STYLE_CATEGORIES.includes(style.category), `${style.name} 分类不在 STYLE_CATEGORIES`)
    assert.ok(style.swatch.trim() !== '', `${style.name} 色板为空`)
    assert.ok(style.name.trim() !== '', `${style.name} 名称为空`)
  }
})

test('D1-2 与成片风格预设零重名（两层并存，名字也不能撞）', () => {
  const presetNames = PRESETS_MD.split('\n')
    .filter(line => line.startsWith('| '))
    .filter(line => !line.includes(' --- '))
    .map(line => line.split('|')[1]?.trim() ?? '')
  const existing = new Set(presetNames.filter(Boolean))
  assert.ok(existing.size > 0, '没从 style-presets.md 解析到预设名，解析口径坏了')
  for (const style of VISUAL_STYLES) {
    assert.ok(
      !existing.has(style.name),
      `视觉风格「${style.name}」与成片风格预设重名（两表互不引用，名字撞了会迷惑）`,
    )
  }
})

test('取用函数：id → 风格 / 前缀 / 分类过滤', () => {
  const cinematic = visualStyleOf('cinematic')
  assert.ok(cinematic !== undefined)
  assert.equal(cinematic.name, '电影感')
  assert.equal(stylePrefixOf('cinematic'), cinematic.prefix)
  // 未选 / 未知 id ⇒ 空前缀（composeImagePrompt 会跳过）
  assert.equal(visualStyleOf(undefined), undefined)
  assert.equal(visualStyleOf(''), undefined)
  assert.equal(visualStyleOf('no-such-style'), undefined)
  assert.equal(stylePrefixOf(undefined), '')
  // 「全部」返回全量
  assert.equal(stylesInCategory('全部').length, VISUAL_STYLES.length)
  assert.equal(stylesInCategory(undefined).length, VISUAL_STYLES.length)
  // 分类过滤每类至少 1 条（否则 tab 会是空的）
  for (const cat of STYLE_CATEGORIES) {
    assert.ok(stylesInCategory(cat).length > 0, `分类「${cat}」没有条目`)
  }
})

test('N1 兼容反查：老节点只有前缀文本时能认出 id，认不出返回 undefined', () => {
  const cinematic = visualStyleOf('cinematic')
  assert.ok(cinematic !== undefined)
  assert.equal(styleIdOfPrefix(cinematic.prefix), 'cinematic')
  // 老数据形态：空串 / undefined / 认不出的旧短句 ⇒ undefined（UI 回落「风格」）
  assert.equal(styleIdOfPrefix(undefined), undefined)
  assert.equal(styleIdOfPrefix(''), undefined)
  assert.equal(styleIdOfPrefix('电影感构图，宽银幕质感'), undefined)
  assert.equal(NO_STYLE_ID, 'none')
})
