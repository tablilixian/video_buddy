/**
 * CanvasSurface 探针驱动（CV-169 重建：真实鼠标 / 键盘 + 计算样式快照 + 截图）。
 *
 * 为什么不用页内合成的 PointerEvent：合成事件的 `isTrusted === false`，
 * 浏览器**不会**为它置 `:active`，也不走真正的 pointer capture —— 而「按下」
 * 与「拖动中」两态恰恰要靠 `:active` 与 capture 才成立。故这里用
 * `page.mouse` / `page.keyboard` 派发真实输入。
 *
 * 运行（playwright-core 装在隔离目录，仓库内不引第三方依赖）：
 *   NODE_PATH=/tmp/cs-probe-runner/node_modules \
 *     /Users/lilixian/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *     canvas-studio/scripts/probe/drive.mjs [--theme=dark] [--shots=<dir>]
 *
 * 退出码：任一条断言失败即 1（可挂进 CI 前的本地回归）。
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  brandTokensCss,
  readStudioStyles,
  renderTokenBlock,
  HOST_TOKENS_DARK,
  HOST_TOKENS_LIGHT,
} from '../preview-tokens.mjs'

const require = createRequire(import.meta.url)
let chromium
try {
  ({ chromium } = require('playwright-core'))
} catch {
  console.error(
    '缺少 playwright-core（本仓不引这个依赖，避免为回归工具拖进浏览器栈）。\n'
    + '装到隔离目录后重跑：\n'
    + '  mkdir -p /tmp/cs-probe-runner && cd /tmp/cs-probe-runner && npm i playwright-core\n'
    + '  cd canvas-studio && NODE_PATH=/tmp/cs-probe-runner/node_modules node scripts/probe/drive.mjs\n'
    + '（探针产物要先构建：npx tsdown -c scripts/probe/tsdown.probe.config.ts\n'
    + '  并把 scripts/probe/surface-probe.html 拷到 /tmp/cs-surface-probe/）',
  )
  process.exit(2)
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PAGE = 'file:///tmp/cs-surface-probe/surface-probe.html'
const arg = (name, fallback) => {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const THEME = arg('theme', 'light')
const SHOTS = arg('shots', '/tmp/cs-probe-shots')

/**
 * 页面样式 = 宿主语义令牌（--dsw-alias-*）+ 品牌令牌（--cs-*，产品原锚点）
 * + STUDIO_STYLES。三者都走共享助手：手抄令牌会随 brand.ts / styles.ts 漂移，
 * 探针就会安静地截出「看着差不多」的图，比脚本报错贵得多。
 */
const probeCss = [
  `:root {\n${renderTokenBlock(THEME === 'dark' ? HOST_TOKENS_DARK : HOST_TOKENS_LIGHT)}\n}`,
  await brandTokensCss({ productAnchors: true }),
  await readStudioStyles(),
].join('\n')

const results = []
const check = (step, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  results.push({ step, ok, actual: a, expected: e })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  actual=${a}${ok ? '' : `  expected=${e}`}`)
}

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROME, headless: true, chromeSandbox: false })
const page = await browser.newPage({ viewport: { width: 1200, height: 520 }, deviceScaleFactor: 2 })
page.on('pageerror', err => console.log('PAGE_ERROR:', err.message))
page.on('console', msg => { if (msg.type() === 'error') console.log('CONSOLE_ERROR:', msg.text()) })

// 样式与主题属性必须在**首帧之前**到位：否则组件先按浏览器默认样式渲染一帧，
// 节点框尺寸在注入后变化，后面对节点中心的换算就会错位。
await page.addInitScript(({ css, theme }) => {
  const inject = () => {
    const style = document.createElement('style')
    style.textContent = css
    ;(document.head ?? document.documentElement).appendChild(style)
    if (document.body !== null) {
      document.body.setAttribute('data-cs-brand', 'cinema-violet')
      if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject)
  else inject()
}, { css: probeCss, theme: THEME })

await page.goto(`${PAGE}?theme=${THEME}`)
await page.waitForSelector('[data-node-id="A"]', { timeout: 15000 })
await page.waitForTimeout(250)

const root = await page.locator('#root > div').boundingBox()
const shot = async name => { await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: root }) }
const dump = () => page.evaluate(() => window.__probe.dump())
const sel = () => page.evaluate(() => window.__probe.getSelection().slice().sort())
const box = id => page.locator(`[data-node-id="${id}"]`).boundingBox()
const center = async id => { const b = await box(id); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
const setSelected = ids => page.evaluate(list => window.__probe.setSelected(list), ids)
const resetView = () => page.evaluate(() => window.__probe.setSelected([]))

const summary = d => {
  const map = {}
  for (const n of d.nodes) {
    if ('missing' in n) { map[n.id] = 'MISSING'; continue }
    map[n.id] = `${n.cls.replace(/csNode ?/g, '').trim() || '(base)'} | op=${n.opacity} dim=${n.nodeDim} state=${n.nodeState}`
  }
  return map
}
const report = async (label, name) => {
  const d = await dump()
  console.log(`\n--- ${label} ---`)
  for (const [id, text] of Object.entries(summary(d))) console.log(`  ${id}: ${text}`)
  if (name !== undefined) await shot(name)
  return d
}

console.log(`\n===== 探针：theme=${THEME} =====`)

// ===== 状态 1：初始（无选中）=====
const s1 = await report('状态 1 · 初始（无选中）', '1-initial')
check('1.初始无选中', s1.selection, [])
check('1.初始全部不压暗', s1.nodes.map(n => n.nodeDim), ['1', '1', '1'])

// ===== 状态 2：选中 B 并按下（按下不松手）=====
// B 有上游血缘（sourceIds=['A']）→ 聚光生效：A 一起亮、C 压暗。
const b = await center('B')
await page.mouse.move(b.x, b.y)
await page.mouse.down()
await page.waitForTimeout(80)
const s2 = await report('状态 2 · 选中 B 并按住（未移动）', '2-pressed')
check('2.按下即单选 B', s2.selection, ['B'])
check('2.按下的节点是 primary+selected', s2.nodes.find(n => n.id === 'B').cls.split(' ').sort(), ['csNode', 'csNodePrimary', 'csNodeSelected'])
check('2.无血缘的 C 被压暗', s2.nodes.find(n => n.id === 'C').nodeDim, '0.42')
check('2.有血缘的 A 不被压暗', s2.nodes.find(n => n.id === 'A').nodeDim, '1')

// ===== 状态 3：拖动中（仍按住，位移已过 3px 阈值）=====
await page.mouse.move(b.x + 120, b.y + 40, { steps: 6 })
await page.waitForTimeout(80)
const s3 = await report('状态 3 · 拖动中', '3-dragging')
check('3.拖动中仍是单选 B', s3.selection, ['B'])
check('3.拖动中 B 保持 primary', s3.nodes.find(n => n.id === 'B').cls.split(' ').sort(), ['csNode', 'csNodePrimary', 'csNodeSelected'])
check('3.拖动中 C 仍压暗（松手前不恢复）', s3.nodes.find(n => n.id === 'C').nodeDim, '0.42')
await page.mouse.up()
await page.waitForTimeout(80)

// ===== 状态 4：Ctrl 加选 / 减选（CV-166 回归点）=====
await page.keyboard.down('Control')
const a = await center('A')
await page.mouse.click(a.x, a.y)
await page.waitForTimeout(60)
check('4a.Ctrl+点 A = 加选（B,A）', await sel(), ['A', 'B'])
const c = await center('C')
await page.mouse.click(c.x, c.y)
await page.waitForTimeout(60)
check('4b.Ctrl+点 C = 再加（A,B,C）', await sel(), ['A', 'B', 'C'])
await page.mouse.click(a.x, a.y)
await page.waitForTimeout(60)
check('4c.Ctrl+点已选 A = 减选（B,C）', await sel(), ['B', 'C'])
await page.keyboard.up('Control')

// 4d：带修饰键的按下不产生位移（点人不拖 = 只改选区，不动节点）
const posBefore = (await dump()).positions
await page.keyboard.down('Control')
const bAgain = await center('B')
await page.mouse.move(bAgain.x, bAgain.y)
await page.mouse.down()
await page.mouse.move(bAgain.x + 60, bAgain.y + 24, { steps: 4 })
await page.mouse.up()
await page.keyboard.up('Control')
await page.waitForTimeout(60)
check('4d.Ctrl+拖不动节点', (await dump()).positions, posBefore)

// ===== 状态 5：Shift + 点节点（CV-166 次生回归点）=====
await setSelected(['A', 'C'])
await page.waitForTimeout(60)
await page.keyboard.down('Shift')
const c5 = await center('B')
await page.mouse.click(c5.x, c5.y)
await page.keyboard.up('Shift')
await page.waitForTimeout(60)
check('5.Shift+点 B = 选中 B（不是清空）', await sel(), ['B'])

// ===== 状态 6：多选区成员语义（CV-167 已修，防回归）=====
await setSelected(['B', 'C'])
await page.waitForTimeout(60)
const b6 = await center('B')
await page.mouse.move(b6.x, b6.y)
await page.mouse.down()
await page.waitForTimeout(60)
check('6a.按住成员：整队保持选中', await sel(), ['B', 'C'])
await page.mouse.move(b6.x + 80, b6.y, { steps: 4 })
await page.waitForTimeout(60)
const pos6 = (await dump()).positions
check('6b.拖成员：整队一起动（C 也动）', pos6.C !== posBefore.C, true)
await page.mouse.up()
await page.waitForTimeout(60)
check('6c.拖动后整队仍选中', await sel(), ['B', 'C'])
// 原地点击成员 → 塌缩为单选
const b6b = await center('B')
await page.mouse.click(b6b.x, b6b.y)
await page.waitForTimeout(60)
check('6d.原地点击成员 → 塌缩单选 B', await sel(), ['B'])

// ===== 状态 7：空白按下即清选 =====
await setSelected(['A', 'B'])
await page.waitForTimeout(60)
await page.mouse.move(1060, 390)
await page.mouse.down()
await page.waitForTimeout(40)
check('7a.空白按下即清选', await sel(), [])
await page.mouse.up()

const errors = await page.evaluate(() => window.__probeErrors)
check('8.探针页无运行时错误', errors, [])

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
console.log(`截图目录：${SHOTS}`)
process.exit(failed.length === 0 ? 0 : 1)
