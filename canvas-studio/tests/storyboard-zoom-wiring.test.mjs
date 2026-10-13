/**
 * CV-311 **接线守卫**：故事板「点开看原图」必须开 app 内缩放浮层，而不是跳出系统浏览器。
 *
 * 病灶类型与 CV-303 同款 —— 链路有四段，断哪一段行为都退化成「点了没反应 / 跳出 app」：
 * ① 渲染层留 `a.zoom` 钩子（零 JS 文档自身不带脚本）；② 父层在**同源 iframe 的
 * document** 上挂**捕获阶段** click；③ 命中钩子后 `preventDefault` 拦下默认导航
 * （`target="_blank"` 会经 Electron openExternal 跳出浏览器，且资产路由
 * loopback authority 会 403 —— CV-246a 真机结论）；④ 开 `ImageZoomModal`。
 *
 * **2026-10-13 真机复现的第五段病灶（跨 realm instanceof）**：③ 的命中判定若写
 * `target instanceof Element`，比对的是**父窗口**构造器，而点击目标属于 iframe
 * 自己的 realm（原型链不共享）⇒ 恒 false ⇒ 判定提前 return、preventDefault 永远
 * 走不到。**源码字符串守卫照不出这类 bug**（closest/preventDefault 字面量都在），
 * 所以本文件除了读源码，还对 `lib/storyboard-zoom.js` 跑**行为级**用例：喂一个
 * 与任何 DOM 构造器都不沾边的 target，命中必须返回 href 且拦下默认导航。
 *
 * 手法与 `storyboard-land-wiring.test.mjs` 同款：读源码、剥注释、字符串断言 ——
 * 够用，且改坏了会红。
 *
 * 运行：corepack yarn test:smoke（行为级用例读 lib/ 产物，须先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { storyboardZoomHref } from '../lib/storyboard-zoom.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 剥掉注释再读源码 —— 注释里的示例会把接线守卫喂饱。 */
function sourceOf(relative) {
  return readFileSync(join(SRC_DIR, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

test('CV-311 ①：故事板渲染层必须留 a.zoom 钩子（父层拦截的唯一标识）', () => {
  const render = sourceOf('storyboard-render.ts')
  assert.match(render, /<a class="zoom" href=/,
    '基调样张必须包在 class="zoom" 锚点里 —— 没有钩子父层无从拦截，点击会退回浏览器')
})

test('CV-311 ②：父层必须在 iframe document 上挂捕获阶段 click 监听', () => {
  const frame = sourceOf('client/StudioFrame.tsx')
  assert.match(frame, /ref=\{sbZoomFrameRef\}/,
    'iframe 必须挂 ref —— 拿不到 contentDocument 就没法在文档内拦截点击')
  assert.match(frame, /addEventListener\('click', handleSbZoomCapture, true\)/,
    '监听必须是**捕获阶段**（true）—— 挂在冒泡阶段拦不住锚点自身的默认导航')
  assert.match(frame, /onLoad=\{\(\) => \{ attachSbZoomCapture\(\) \}\}/,
    'iframe onLoad 必须重挂监听 —— src（rev/version）变化会换 document，只靠 effect 会扑空')
})

test('CV-311 ③：命中判定必须跨 realm 安全 + preventDefault（否则跳出系统浏览器）', () => {
  const zoom = sourceOf('storyboard-zoom.ts')
  assert.match(zoom, /\.call\(el, 'a\.zoom'\)/,
    '必须按 a.zoom 钩子判定命中（点在 <img> 上也要能命中到祖先锚点），且 this 绑回 target')
  assert.match(zoom, /event\.preventDefault\(\)/,
    '命中后必须 preventDefault —— 漏了它 Electron setWindowOpenHandler 照样触发 openExternal')
  assert.doesNotMatch(zoom, /instanceof\s+(Element|HTMLAnchorElement)/,
    '跨 realm 禁用 instanceof —— 点击目标属于 iframe 自己的 realm，'
    + '父窗口构造器比对恒 false ⇒ 提前 return ⇒ 从不 preventDefault ⇒ 真机跳出浏览器（2026-10-13 已踩）')

  const frame = sourceOf('client/StudioFrame.tsx')
  assert.match(frame, /import \{ storyboardZoomHref \} from '\.\.\/storyboard-zoom\.js'/,
    'StudioFrame 必须走 storyboard-zoom 的唯一命中实现（自己再写一遍必然重蹈 instanceof 覆辙）')
  assert.match(frame, /storyboardZoomHref\(event\)/,
    '捕获 handler 必须委托 storyboardZoomHref 解析')
  assert.match(frame, /setSbZoomUrl\(href\)/,
    '必须把解析后的绝对 href 交给浮层（相对路径在浮层里解析不出资源）')
})

test('CV-311 ③b：行为级 —— 与 DOM 构造器不沾边的 target 也必须命中并拦下默认导航', () => {
  // 跨 realm 的最小复现：Node 里没有 DOM 构造器，这个 target 不是任何
  // Element/HTMLAnchorElement 的实例 —— 与 iframe realm 的元素在 instanceof
  // 判定上的处境完全一致。若实现退回 instanceof，这里必红。
  const href = 'http://127.0.0.1:7700/canvas-studio/assets/demo/look.png'
  const anchor = { href }
  const target = { closest: (selector) => (selector === 'a.zoom' ? anchor : null) }
  let prevented = 0
  let stopped = 0
  const event = {
    target,
    preventDefault: () => { prevented += 1 },
    stopPropagation: () => { stopped += 1 },
  }
  assert.equal(storyboardZoomHref(event), href, '必须返回锚点的绝对 href')
  assert.equal(prevented, 1, '必须 preventDefault —— 拦不住就跳出系统浏览器')
  assert.equal(stopped, 1, '必须 stopPropagation —— 不然锚点默认导航照样走')
})

test('CV-311 ③c：行为级 —— 未命中一律不拦（§01 来源链接与非元素目标）', () => {
  // §01 外部来源链接：closest 存在但不命中 a.zoom ⇒ 不得 preventDefault。
  const outside = { href: 'https://example.com/ref' }
  const missAnchor = { closest: () => null }
  let prevented = 0
  const missEvent = {
    target: missAnchor,
    preventDefault: () => { prevented += 1 },
    stopPropagation: () => { prevented += 10 },
  }
  assert.equal(storyboardZoomHref(missEvent), null)
  assert.equal(prevented, 0, '非 a.zoom 链接不许拦（外部 URL 保持原生打开语义）')

  // 非元素目标（Document / 文本节点等，没有 closest）⇒ 未命中且不抛。
  let prevented2 = 0
  const bareEvent = {
    target: {},
    preventDefault: () => { prevented2 += 1 },
    stopPropagation: () => { prevented2 += 10 },
  }
  assert.equal(storyboardZoomHref(bareEvent), null)
  assert.equal(prevented2, 0)

  // 空 href 一并视为未命中（拦下一个打不开的浮层比放行更糟）。
  const emptyEvent = {
    target: { closest: () => ({ href: '' }) },
    preventDefault: () => { prevented2 += 100 },
    stopPropagation: () => { prevented2 += 1000 },
  }
  assert.equal(storyboardZoomHref(emptyEvent), null)
  assert.equal(prevented2, 0)
})

test('CV-311 ④：浮层渲染与组件能力（ImageZoomModal 开得出来、且真的支持缩放/关闭）', () => {
  const frame = sourceOf('client/StudioFrame.tsx')
  assert.match(frame, /sbZoomUrl !== null && \(\s*<ImageZoomModal/,
    'sbZoomUrl 非空时必须渲染 ImageZoomModal —— 漏接等于「点了没反应」')
  assert.match(frame, /import \{ ImageZoomModal \} from '\.\/canvas\/ImageZoomModal\.js'/,
    '必须从 ./canvas/ImageZoomModal.js 导入')

  const modal = sourceOf('client/canvas/ImageZoomModal.tsx')
  assert.match(modal, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/,
    '滚轮缩放必须挂 non-passive 监听 —— React onWheel 在根上是 passive，preventDefault 不生效')
  assert.match(modal, /event\.key === 'Escape'/,
    'Escape 必须能关（同族浮层的关闭口径）')
  assert.match(modal, /onDoubleClick=/,
    '双击必须在适配 ↔ 100% 之间切换（「可自由缩放」的验收口径）')
  assert.match(modal, /setPointerCapture/,
    '拖拽平移必须用 pointer capture —— 否则拖出 stage 就断')

  // 2026-10-13 二轮反馈「框太小」：不得复用 csVideoModalCard 的 width:auto
  // （grid 居中 + fit-content，图加载后 stage 无流内内容 ⇒ 卡片收缩成
  // 标题栏窄条），必须显式大宽度 + 配套 stage 定高。
  assert.match(modal, /csModal csImageZoomCard/,
    '卡片必须用 csImageZoomCard —— csVideoModalCard 的 width:auto 会把卡收缩成标题栏窄条')
  const styles = sourceOf('client/styles.ts')
  assert.match(styles, /\.csImageZoomCard \{\s*width: min\(/,
    'csImageZoomCard 必须显式大宽度（fit-content 会塌成窄条）')
  assert.match(styles, /\.csImageZoomStage \{[\s\S]*?height: min\(/,
    'stage 必须定高 —— 图是绝对定位撑不起内容高')
})
