/**
 * REQ-041 · 分镜卡版式守卫（G1 源码闸，2026-11-25 真机回归）。
 *
 * 根因回顾：段视频上卡后，`.csNodeSelected .csNodeBody`（CV-081，为长分镜稿
 * 解除折叠）会把整份 8 行分镜稿摊进 flex 体区，与段视频争抢高度 ⇒ 视频被压成
 * 一条、正文骑在画面上。真机截图就是这条规则与段视频卡叠加的结果。
 *
 * 本闸钉三件事，任何一条被删/被改回去都必须变红：
 *   ① 段视频框有正向 min-height（正文再长也压不没画面）；
 *   ② 段视频卡的正文规则对**选中态**也生效，且钳两行、不许 unset；
 *   ③ CV-081 的通用选中展开规则仍在（修这条不能用删别人功能的方式）。
 *
 * 无 React 渲染环境，按本仓惯例用源码闸钉结构性前提；视觉验收仍靠真机。
 * 运行：corepack yarn test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** 去注释切片：断言只看声明本体，不被注释里的说明文字骗过。 */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const STYLES = codeOnly(readFileSync(join(here, '..', 'src', 'client', 'styles.ts'), 'utf8'))

function ruleBlock(source, selectorPattern) {
  const match = source.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `找不到规则块：${selectorPattern}`)
  return match[1]
}

test('① 段视频框必须有正向 min-height —— 正文不许把画面压成一条', () => {
  const block = ruleBlock(STYLES, '\\.csNodeSegmentVideoBox')
  const minHeight = block.match(/min-height:\s*(\d+)px/)
  assert.ok(minHeight, '.csNodeSegmentVideoBox 缺 min-height：正文一长就把视频压到 0（真机重叠回归）')
  assert.ok(Number(minHeight[1]) >= 48, `min-height 太小（${minHeight[1]}px）：16:9 画面小于 85×48，读不出这一屏`)
  assert.ok(block.includes('overflow: hidden'), '视频框要裁溢出，否则 contain 之外的黑边会盖住正文')
})

test('② 段视频卡正文：选中态也钳两行，不许 unset（重叠的直接成因）', () => {
  const block = ruleBlock(STYLES, '\\.csNodeSegmentCard[^{]*?\\.csNodeBody')
  assert.ok(block.includes('-webkit-line-clamp: 2'), '段视频卡正文必须钳两行，否则 8 行分镜稿把视频挤没')
  assert.ok(!/line-clamp:\s*unset/.test(block), '选中态不许解除钳制：那是「文字骑在视频上」的原始成因')
  assert.ok(block.includes('-webkit-box'), '钳行必须配 display:-webkit-box，否则 -webkit-line-clamp 不生效')
  assert.ok(/flex:\s*0\s+0\s+auto/.test(block), '正文不参与伸缩，剩余高度归视频')
})

test('③ 选中态覆盖必须真的能压过 .csNodeSelected .csNodeBody（特异度）', () => {
  // 两条规则都是「两个类 + 后代类」时后写者胜；段视频规则必须显式带上选中态类，
  // 否则选中卡（也就是用户提意见的那张卡）恰好走 CV-081 的展开分支。
  assert.ok(/\.csNodeSegmentCard\.csNodeSelected\s+\.csNodeBody/.test(STYLES),
    '缺 .csNodeSegmentCard.csNodeSelected .csNodeBody 覆盖 —— 选中卡必然重叠')
})

test('④ CV-081 通用选中展开仍在 —— 修分镜卡不等于删长文能力', () => {
  // 行首锚定：段视频卡的规则里也含 `.csNodeSelected .csNodeBody` 字样，
  // 不锚定就会拿到自己那条（它本来就该含 clamp 2、不含 unset）。
  const match = STYLES.match(/(?:^|\n)\.csNodeSelected\s+\.csNodeBody\s*\{([^}]*)\}/)
  assert.ok(match, 'CV-081 的通用选中展开规则整条不见了')
  const block = match[1]
  assert.ok(/line-clamp:\s*unset/.test(block), 'CV-081 被连带删掉：长分镜稿/脚本将无法在选中态展开阅读')
  assert.ok(block.includes('overflow-y: auto'), 'CV-081 的可滚动兜底丢失')
})
