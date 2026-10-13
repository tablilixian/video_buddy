/**
 * CV-311 **接线守卫**：故事板「点开看原图」必须开 app 内缩放浮层，而不是跳出系统浏览器。
 *
 * 病灶类型与 CV-303 同款 —— 链路有四段，断哪一段行为都退化成「点了没反应 / 跳出 app」：
 * ① 渲染层留 `a.zoom` 钩子（零 JS 文档自身不带脚本）；② 父层在**同源 iframe 的
 * document** 上挂**捕获阶段** click；③ 命中钩子后 `preventDefault` 拦下默认导航
 * （`target="_blank"` 会经 Electron openExternal 跳出浏览器，且资产路由
 * loopback authority 会 403 —— CV-246a 真机结论）；④ 开 `ImageZoomModal`。
 *
 * 任何单段测试都照不到「漏挂监听 / 挂在冒泡阶段 / 漏 preventDefault」——
 * 只有把四段串起来断言。手法与 `storyboard-land-wiring.test.mjs` 同款：
 * 读源码、剥注释、字符串断言 —— 够用，且改坏了会红。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

test('CV-311 ③：命中钩子后必须 preventDefault（否则 target=_blank 仍会跳出系统浏览器）', () => {
  const frame = sourceOf('client/StudioFrame.tsx')
  assert.match(frame, /closest\('a\.zoom'\)/,
    '必须按 a.zoom 钩子判定命中（点在 <img> 上也要能命中到祖先锚点）')
  assert.match(frame, /event\.preventDefault\(\)/,
    '命中后必须 preventDefault —— 漏了它 Electron setWindowOpenHandler 照样触发 openExternal')
  assert.match(frame, /setSbZoomUrl\(anchor\.href\)/,
    '必须把解析后的绝对 href 交给浮层（相对路径在浮层里解析不出资源）')
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
})
