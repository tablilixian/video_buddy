/**
 * CV-283（REQ-029/031 验收前修正批）「同框对齐」守卫 —— 阶段一几何与共存口径；
 * CV-285 追加「chrome 比例补偿」（方案 A：k = clamp(节点宽/620, 0.75, 4)）。
 *
 * 拍板（方案 §0.3 / §二，全部**推翻** CV-281/282 旧口径，此处钉新口径）：
 *   ① 砍放大态：卡只剩单一形态（演示 body.zoomed / 展开钮移除）；
 *   ③ 同框共存：卡打开时就近工具条**不退场**（卡锚下沿、条锚上沿，不重叠）；
 *   间隙：卡与工具条共用 canvas-view.CHROME_GAP(12)×视觉比例（演示 placeChrome
 *     原式，此前「紧贴无间隙」为 loose 文案）；
 *   缩放：卡与工具条都挂**独立 scale 属性**（演示 --chrome-scale，与画布 100% 对齐），
 *     水平居中走**独立 translate -50%**（视觉中心 = 定位点 left，演示 --chrome-x）；
 *   纵向不做视口夹取（演示：钉在视口会与图脱开）—— 只留横向夹取（产品偏差 §九）
 *     与详情抽屉打开时的顶夹避让；工具条不再翻「下方」、不再读抽屉 inset。
 *
 * CV-285（比例补偿，方案 A）：演示节点恒 620px（`.node{width:min(620px,74vw)}`），
 *   chrome 字号/尺寸按 620 基准调观感；自然像素节点（CV-284）下同样绝对 px 的
 *   chrome/节点比值随图宽掉档（1280 → 0.48 倍）。补偿：视觉比例 = z × k，
 *   k = chromeScaleOf(节点宽)；间隙同乘 k；工具条另按视口宽封顶（整条留屏内）；
 *   卡布局宽反推（视觉宽 ≤ 92% 可视区），字号不缩只收行宽。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法：够用、改坏了会红）；
 * chromeScaleOf / nodeActionAnchor 的数学在文末用 **lib 实测**（纯函数直连）。
 *
 * 运行：corepack yarn test:smoke（顶部 import ../lib/ —— 须先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { CHROME_CARD_WIDTH } from '../lib/canvas-aspect.js'
import {
  CHROME_GAP,
  CHROME_REF_WIDTH,
  chromeScaleOf,
  nodeActionAnchor,
} from '../lib/canvas-view.js'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('CV-283 间隙：CHROME_GAP = 12 唯一导出，卡与工具条同源消费', async () => {
  const view = await read('src/canvas-view.ts')
  // 唯一事实源：旧 NODE_ACTION_GAP(8) 不许回潮。
  assert.match(view, /export const CHROME_GAP = 12/, 'CHROME_GAP 必须 = 演示 12')
  assert.equal(view.includes('NODE_ACTION_GAP'), false, '旧 NODE_ACTION_GAP(8) 必须移除')
  // 工具条锚：gap 随视觉比例缩放（演示 --tb-top = r.top - gap - barH，其 k≡1）。
  assert.match(view, /const y = top - CHROME_GAP \* visualScale - bar\.height/, '工具条纵距必须 = nodeTop − 12×视觉比例 − barH（barH 不乘：原点在底边）')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /import \{ CHROME_GAP, chromeScaleOf \} from '\.\.\/\.\.\/canvas-view\.js'/, '卡必须 import 同一个 CHROME_GAP（连同比例补偿同源）')
  assert.match(card, /const top = nodeBottom \+ CHROME_GAP \* effScale/, '卡上沿必须 = 节点下沿 + 12×视觉比例')
})

test('CV-283 缩放与居中：卡/条都走独立 scale + translate -50%（演示 --chrome-scale）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const bar = await read('src/client/canvas/NodeActionBar.tsx')
  const styles = await read('src/client/styles.ts')
  // 独立属性写进 style（不进 transform 列表：入场动画的 transform 槽位不被覆盖，
  // 缩放变化也不吃 transition）。视觉比例：卡 = z×k（effScale），条 = anchor.visualScale。
  assert.ok(
    card.includes('style={{ left: clampedLeft, top: clampedTop, width: `${Math.round(layoutWidth)}px`, scale: `${effScale}` }}'),
    '卡必须挂独立 scale（含 k）+ 反推布局宽',
  )
  assert.ok(
    bar.includes('style={{ left: anchor.x, top: anchor.y, scale: `${anchor.visualScale}` }}'),
    '工具条必须挂独立 scale（anchor.visualScale，与夹取同源）',
  )
  // 水平居中 = 独立 translate（视觉中心恒等于 left，演示 --chrome-x 同式）。
  assert.match(styles, /\.csNodeInputCard \{[\s\S]*?translate: -50% 0; transform-origin: 50% 0;/, '卡必须 translate -50% + 顶缘为原点')
  assert.match(styles, /\.csNodeActionBar \{[\s\S]*?translate: -50% 0;/, '工具条必须 translate -50%')
  assert.match(styles, /\.csNodeActionBar \{[\s\S]*?transform-origin: bottom center;/, '工具条原点必须在下缘（从节点上边缘抽出）')
})

test('CV-283 纵向不夹取：卡去视口 clamp（留抽屉顶夹），条去 minY/maxY 与下方翻转', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const view = await read('src/canvas-view.ts')
  const bar = await read('src/client/canvas/NodeActionBar.tsx')
  // 卡：不再 Math.max(top, 8) 钉视口；横向夹取（按视觉半宽）与抽屉顶夹保留。
  assert.equal(card.includes('Math.max(top, 8)'), false, '卡不得再钉视口顶（演示：钉住会与图脱开）')
  assert.match(card, /half \* effScale \+ 8/, '横向夹取必须按视觉半宽（布局半宽×视觉比例）')
  assert.match(card, /bottomInset > 0 && size\.height > 0 && maxTop > 0/, '抽屉打开时必须顶夹避让（产品独有面）')
  // 条：锚函数不再有 minY/maxY/翻转/placement 字段，也不读抽屉 inset。
  assert.equal(view.includes('placement'), false, '工具条不得再有 placement（恒在上方）')
  assert.equal(view.includes('bottomInset'), false, '锚函数不得再读抽屉 inset（纵向已不夹）')
  assert.match(view, /return \{ x, y, visible, visualScale \}/, '锚结果 = x/y/visible/visualScale')
  // 调用侧同步：bar 不再传 bottomInset；anchor.x 是定位点（中心），CSS 负责居中。
  assert.match(bar, /nodeActionAnchor\(node, view, viewport, size\)/, '工具条调用不得再传 bottomInset')
  assert.equal(bar.includes('bottomInset'), false, 'NodeActionBar 不得再持有 bottomInset')
})

test('CV-283 同框共存：卡打开时工具条不退场（拍板③），图像/视频工具条同框对齐', async () => {
  const surface = await read('src/client/canvas/CanvasSurface.tsx')
  // 渲染条件只看 actionBarNode（选中 + 单选手势），不再以卡打开为由退场。
  assert.match(surface, /actionBarNode !== null && \(/, '工具条渲染条件不得包含卡打开判据')
  assert.equal(
    /actionBarNode !== null && cardNodeId === null/.test(surface),
    false,
    '不得以「卡打开」为由让工具条退场',
  )
  // 同框的两面都必须真的渲染。
  assert.match(surface, /<NodeActionBar/, '同框必须渲染工具条')
  assert.match(surface, /<NodeInputCard/, '同框必须渲染输入框卡')
})

test('CV-285 比例补偿：chromeScaleOf 基准/上下限与 visualScale 合成（lib 实测）', async () => {
  // 基准：演示 .node 620 / .panel 760 —— 写死或改数都会破坏「与效果图 1:1 比值」。
  assert.equal(CHROME_REF_WIDTH, 620, '补偿分母必须 = 演示节点基准 620')
  assert.equal(CHROME_CARD_WIDTH, 760, '卡基准宽必须 = 演示 .panel 760')
  assert.equal(CHROME_GAP, 12)
  // k 数学：620→1（精确区），常见生成宽度线性，带外夹取，非法回退 1。
  assert.equal(chromeScaleOf(620), 1, '基准宽 k 必须 = 1')
  assert.ok(Math.abs(chromeScaleOf(1280) - 1280 / 620) < 1e-9, '1280 宽必须精确补偿（1280/620）')
  assert.ok(Math.abs(chromeScaleOf(1920) - 1920 / 620) < 1e-9, '1920 宽必须在线性带内（620×4=2480 覆盖）')
  assert.equal(chromeScaleOf(308), 0.75, '小节点必须夹到下限 0.75（字号可读）')
  assert.equal(chromeScaleOf(4096), 4, '超大节点必须夹到上限 4')
  assert.equal(chromeScaleOf(0), 1, '非法宽回退 1（等价旧口径）')
  assert.equal(chromeScaleOf(-5), 1, '负宽回退 1')
  assert.equal(chromeScaleOf(Number.NaN), 1, 'NaN 回退 1')
  // visualScale = z × k（宽视口下不触发上限）；y = nodeTop − 12×比例 − barH。
  const k = 1280 / 620
  const anchor = nodeActionAnchor(
    { x: 10, y: 20, width: 1280, height: 784 },
    { x: 0, y: 0, scale: 1 },
    { width: 4000, height: 2000 },
    { width: 300, height: 40 },
  )
  assert.ok(Math.abs(anchor.visualScale - k) < 1e-9, 'visualScale 必须 = z×k')
  assert.ok(Math.abs(anchor.y - (20 - CHROME_GAP * k - 40)) < 1e-9, 'y 必须 = nodeTop − 12×比例 − barH')
  // 视口封顶：条将比视口宽时压到 (vw − 2×边距)/barW —— 整条留屏内优先于比值。
  const narrow = nodeActionAnchor(
    { x: 10, y: 20, width: 1280, height: 784 },
    { x: 0, y: 0, scale: 1 },
    { width: 600, height: 2000 },
    { width: 300, height: 40 },
  )
  assert.ok(narrow.visualScale < k, '窄视口必须触发封顶')
  assert.ok(Math.abs(narrow.visualScale - (600 - 16) / 300) < 1e-9, '封顶值 = (vw−2×8)/barW')
})

test('CV-285 卡布局宽反推：视觉宽 ≤ 92% 可视区，字号不缩只收行宽', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  // 反推式：布局宽 = min(演示 760, 92%可视区/effScale) —— k>1 时若不除掉 k，
  // 760×k×z 会整卡甩出视口（夹取只能居中、救不了两侧裁切）。
  assert.match(
    card,
    /const layoutWidth = Math\.min\(CHROME_CARD_WIDTH, \(viewport\.width \* 0\.92\) \/ Math\.max\(effScale, 1e-6\)\)/,
    '布局宽必须按 effScale 反推（演示 min(760px,92vw) 的同式收敛）',
  )
  assert.match(card, /const effScale = scale \* chromeScaleOf\(node\.width\)/, '视觉比例必须 = z × chromeScaleOf(节点宽)')
  const styles = await read('src/client/styles.ts')
  // styles 基准宽插值同源（写死 760 会与内联反推上限静默漂移）。
  assert.match(styles, /width: min\(\$\{CHROME_CARD_WIDTH\}px, 92vw\);/, 'styles 卡宽必须插值 CHROME_CARD_WIDTH')
  assert.match(styles, /import \{ CHROME_CARD_WIDTH \} from '\.\.\/canvas-aspect\.js'/, 'styles 必须从 canvas-aspect import 卡宽常量（preview-tokens 只解析 aspect 导出）')
})
