/**
 * CV-283（REQ-029/031 验收前修正批）「同框对齐」守卫 —— 阶段一几何与共存口径。
 *
 * 拍板（方案 §0.3 / §二，全部**推翻** CV-281/282 旧口径，此处钉新口径）：
 *   ① 砍放大态：卡只剩单一形态（演示 body.zoomed / 展开钮移除）；
 *   ③ 同框共存：卡打开时就近工具条**不退场**（卡锚下沿、条锚上沿，不重叠）；
 *   间隙：卡与工具条共用 canvas-view.CHROME_GAP(12)×z（演示 placeChrome 原式，
 *     此前「紧贴无间隙」为 loose 文案）；
 *   缩放：卡与工具条都挂**独立 scale 属性**（演示 --chrome-scale，与画布 100% 对齐），
 *     水平居中走**独立 translate -50%**（视觉中心 = 定位点 left，演示 --chrome-x）；
 *   纵向不做视口夹取（演示：钉在视口会与图脱开）—— 只留横向夹取（产品偏差 §九）
 *     与详情抽屉打开时的顶夹避让；工具条不再翻「下方」、不再读抽屉 inset。
 *
 * 源码级字符串断言（与 canvas-prompt-edit.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('CV-283 间隙：CHROME_GAP = 12 唯一导出，卡与工具条同源消费', async () => {
  const view = await read('src/canvas-view.ts')
  // 唯一事实源：旧 NODE_ACTION_GAP(8) 不许回潮。
  assert.match(view, /export const CHROME_GAP = 12/, 'CHROME_GAP 必须 = 演示 12')
  assert.equal(view.includes('NODE_ACTION_GAP'), false, '旧 NODE_ACTION_GAP(8) 必须移除')
  // 工具条锚：gap 随画布缩放（演示 --tb-top = r.top - gap - barH）。
  assert.match(view, /const y = top - CHROME_GAP \* view\.scale - bar\.height/, '工具条纵距必须 = nodeTop − 12×z − barH')
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  assert.match(card, /import \{ CHROME_GAP \} from '\.\.\/\.\.\/canvas-view\.js'/, '卡必须 import 同一个 CHROME_GAP')
  assert.match(card, /const top = nodeBottom \+ CHROME_GAP \* scale/, '卡上沿必须 = 节点下沿 + 12×z')
})

test('CV-283 缩放与居中：卡/条都走独立 scale + translate -50%（演示 --chrome-scale）', async () => {
  const card = await read('src/client/canvas/NodeInputCard.tsx')
  const bar = await read('src/client/canvas/NodeActionBar.tsx')
  const styles = await read('src/client/styles.ts')
  // 独立属性写进 style（不进 transform 列表：入场动画的 transform 槽位不被覆盖，
  // 缩放变化也不吃 transition）。
  assert.match(card, /style=\{\{ left: clampedLeft, top: clampedTop, scale: `\$\{scale\}` \}\}/, '卡必须挂独立 scale')
  assert.match(bar, /style=\{\{ left: anchor\.x, top: anchor\.y, scale: `\$\{view\.scale\}` \}\}/, '工具条必须挂独立 scale')
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
  assert.match(card, /half \* scale \+ 8/, '横向夹取必须按视觉半宽（布局半宽×z）')
  assert.match(card, /bottomInset > 0 && size\.height > 0 && maxTop > 0/, '抽屉打开时必须顶夹避让（产品独有面）')
  // 条：锚函数不再有 minY/maxY/翻转/placement 字段，也不读抽屉 inset。
  assert.equal(view.includes('placement'), false, '工具条不得再有 placement（恒在上方）')
  assert.equal(view.includes('bottomInset'), false, '锚函数不得再读抽屉 inset（纵向已不夹）')
  assert.match(view, /return \{ x, y, visible \}/, '锚结果只剩 x/y/visible')
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
