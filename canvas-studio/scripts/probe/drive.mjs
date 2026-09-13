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
// B 有上游血缘（sourceIds=['A']），但 2026-09-13 起**压暗已取消** ——
// 三个节点都必须保持 dim=1。旧版这里断言「A 亮、C 暗」，正是那条断言把
// 「实现符合设计」锁成了绿色，而用户在真机上看到的就是「一选就暗一片」。
const b = await center('B')
await page.mouse.move(b.x, b.y)
await page.mouse.down()
await page.waitForTimeout(80)
const s2 = await report('状态 2 · 选中 B 并按住（未移动）', '2-pressed')
check('2.按下即单选 B', s2.selection, ['B'])
check('2.按下的节点是 primary+selected', s2.nodes.find(n => n.id === 'B').cls.split(' ').sort(), ['csNode', 'csNodePrimary', 'csNodeSelected'])
check('2.C 不被压暗（取消压暗后恒为 1）', s2.nodes.find(n => n.id === 'C').nodeDim, '1')
check('2.A 不被压暗', s2.nodes.find(n => n.id === 'A').nodeDim, '1')

// ===== 状态 3：拖动中（仍按住，位移已过 3px 阈值）=====
await page.mouse.move(b.x + 120, b.y + 40, { steps: 6 })
await page.waitForTimeout(80)
const s3 = await report('状态 3 · 拖动中', '3-dragging')
check('3.拖动中仍是单选 B', s3.selection, ['B'])
check('3.拖动中 B 保持 primary', s3.nodes.find(n => n.id === 'B').cls.split(' ').sort(), ['csNode', 'csNodePrimary', 'csNodeSelected'])
check('3.拖动中 C 不变暗', s3.nodes.find(n => n.id === 'C').nodeDim, '1')
await page.mouse.up()
await page.waitForTimeout(300)

// ===== 状态 3b：松手后必须回到「普通选中」外观（主拖环消失，且不得有节点变暗）=====
const s3b = await dump()
check('3b.松手后 primary 类被清掉', s3b.nodes.find(n => n.id === 'B').cls.split(' ').sort(), ['csNode', 'csNodeSelected'])
check('3b.松手后 C 依然不变暗', s3b.nodes.find(n => n.id === 'C').nodeDim, '1')

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

// ===== 阶段 B：选中态外观的稳定性 =====
// 判据：**同一个节点处于选中态时，外观不因 hover / 按住而改变**。
// 这条不成立时，用户看到的就是「选中状态自己会变」（CV-169 追查的第二类根因）。
await setSelected(['B'])
await page.mouse.move(1060, 390)
await page.waitForTimeout(320)
const idleSel = (await dump()).nodes.find(n => n.id === 'B')
console.log(`\n  基准（选中·静止）: border=${idleSel.borderColor}`)
console.log(`                     shadow=${idleSel.boxShadow.slice(0, 72)}`)

const bHover = await center('B')
await page.mouse.move(bHover.x, bHover.y)
await page.waitForTimeout(320)
const hoverSel = (await dump()).nodes.find(n => n.id === 'B')
console.log(`  悬停（选中·hover）: border=${hoverSel.borderColor}`)
check('9a.悬停不改变选中边框', hoverSel.borderColor, idleSel.borderColor)
check('9b.悬停不改变选中光晕', hoverSel.boxShadow, idleSel.boxShadow)

// 9c：Ctrl 加选「按住」瞬间 —— 新入选的节点在那一下不许掉光晕。
// （走 Ctrl 是因为无修饰键按下会拿到 csNodePrimary，那条规则自带 2px 环、
//   会盖住 :active 的普通投影，测不出冲突。）
await setSelected(['A'])
await page.mouse.move(1060, 390)
await page.waitForTimeout(200)
await page.keyboard.down('Control')
await page.mouse.move(bHover.x, bHover.y)
await page.mouse.down()
await page.waitForTimeout(320)
const ctrlPress = (await dump()).nodes.find(n => n.id === 'B')
console.log(`  Ctrl 加选按住: cls=[${ctrlPress.cls}] sel=${JSON.stringify(await sel())}`)
console.log(`                shadow=${ctrlPress.boxShadow.slice(0, 72)}`)
check('9c.Ctrl 加选按住时保持选中光晕', ctrlPress.boxShadow, idleSel.boxShadow)
await shot('4-ctrl-press')
await page.mouse.up()
await page.keyboard.up('Control')
await page.waitForTimeout(150)

// 9d：缩放把手中心必须落在把手上 —— 卡片是 overflow:hidden + 圆角，把手一旦
// 用负偏移挂到框外，就会被裁掉一半甚至整块，按在那一角会被判成「空白按下」
// 从而清空选区（CV-169 实测踩到：按右下角 → sel 变空）。
const handleHit = await page.evaluate(() => {
  const el = document.querySelector('[data-node-id="B"] .csNodeResizeSE')
  if (el === null) return 'no-handle'
  const r = el.getBoundingClientRect()
  const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return target === null ? 'null' : String(target.className)
})
console.log(`  右下把手中心命中: ${handleHit}`)
check('9d.缩放把手中心可命中（未被卡片裁掉）', handleHit.includes('csNodeResize'), true)

// ===== 状态 7：**真实拖动之后**点空白必须清选（复刻用户真机序列）=====
// 为什么改成真实拖动前置：旧版这里是 setSelected(['A','B']) 程序化设选区，
// 跳过了整个手势过程 —— 而用户报的恰恰是「拖动之后点空白没反应」。
// 程序化前置测不到 pointer capture / 手势残留对后续 pointerdown 的影响。
await setSelected([])
await page.waitForTimeout(60)
const b7 = await center('B')
await page.mouse.move(b7.x, b7.y)
await page.mouse.down()
await page.mouse.move(b7.x + 60, b7.y + 24, { steps: 5 })
await page.mouse.up()
await page.waitForTimeout(80)
check('7pre.真实拖动后 B 被选中', await sel(), ['B'])

await page.mouse.move(1060, 390)
await page.mouse.down()
await page.waitForTimeout(240)
check('7a.拖动之后点空白仍然按下即清选', await sel(), [])
check('7b.清选后全部节点不暗（dim=1）', (await dump()).nodes.map(n => n.nodeDim), ['1', '1', '1'])
await page.mouse.up()

const errors = await page.evaluate(() => window.__probeErrors)
check('8.探针页无运行时错误', errors, [])

// ===== 状态 11：pointercancel 必须把手势收干净 =====
// 真实输入造不出 pointercancel（那是系统夺走指针才发的），但 React 的处理函数
// 对合成事件一视同仁，故这里用合成事件补这一条路径。判据两条：
//   ① 卡上的 csNodePrimary 必须被摘掉（否则被拖那张永远挂着「按下」的样子）；
//   ② 手势必须真的结束 —— 之后再来 pointermove 不许继续挪节点。
await setSelected(['B'])
await page.mouse.move(1060, 390)
await page.waitForTimeout(120)
const bCancel = await center('B')
await page.mouse.move(bCancel.x, bCancel.y)
await page.mouse.down()
await page.mouse.move(bCancel.x + 70, bCancel.y + 30, { steps: 5 })
await page.waitForTimeout(120)
const during = (await dump()).nodes.find(n => n.id === 'B')
check('11a.拖动中确实是主选中态', during.cls.includes('csNodePrimary'), true)
await page.evaluate(() => {
  document.querySelector('.csCanvasSurface').dispatchEvent(
    new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }),
  )
})
await page.waitForTimeout(200)
const afterCancel = (await dump()).nodes.find(n => n.id === 'B')
check('11b.pointercancel 后摘掉主选中环', afterCancel.cls.includes('csNodePrimary'), false)
check('11c.pointercancel 后仍是选中态（不是退回未选中）', afterCancel.cls.includes('csNodeSelected'), true)
const posAtCancel = (await dump()).positions
await page.mouse.move(bCancel.x + 180, bCancel.y + 90, { steps: 4 })
await page.waitForTimeout(120)
check('11d.pointercancel 后手势已结束（再移不动节点）', (await dump()).positions, posAtCancel)
await page.mouse.up()
await page.waitForTimeout(120)
check('11e.补到的 pointerup 残留不影响选区', (await dump()).selection, ['B'])

await browser.close()

const failed = results.filter(r => !r.ok)
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`)
console.log(`截图目录：${SHOTS}`)
process.exit(failed.length === 0 ? 0 : 1)
