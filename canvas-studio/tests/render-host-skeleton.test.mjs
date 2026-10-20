/**
 * REQ-034 · O-05 RenderHost 骨架守卫。
 *
 * 这一层能自动验的东西有两个层次：
 * - **行为**：生命周期状态机（回收/忙时保活/单实例）与自报状态归一 —— 纯函数，假时钟直接驱动；
 * - **接线**：页面/路由/窗口参数是「写在源码里的约定」，只能按源码断言（真机行为归验收）。
 *
 * 反向变红的口径写在每个用例的注释里，别把它们改成永远为真的断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const { RenderHostLifecycle } = await import('../lib/render-host/lifecycle.js')
const { recordRenderHostReport, lastRenderHostReport, resetRenderHostReport } = await import('../lib/render-host/status.js')
const { renderHostHtml } = await import('../lib/render-host/page.js')
const { resolveElectron } = await import('../lib/render-host/window.js')

/** 假时钟 + 假定时器：让「空闲 5 分钟」在测试里瞬间发生。 */
function fakeClock() {
  let now = 0
  const timers = []
  const schedule = (fn, delayMs) => {
    const entry = { fn, at: now + delayMs, cancelled: false }
    timers.push(entry)
    return () => { entry.cancelled = true }
  }
  const advance = (ms) => {
    now += ms
    for (const timer of timers) {
      if (!timer.cancelled && timer.at <= now) {
        timer.cancelled = true
        timer.fn()
      }
    }
  }
  return { now: () => now, schedule, advance }
}

test('O-05 生命周期：单实例（重复 acquire 返回 false，且不重复定时）', () => {
  const clock = fakeClock()
  const disposed = []
  const life = new RenderHostLifecycle({ idleMs: 1000, now: clock.now, schedule: clock.schedule, onDispose: (r) => disposed.push(r) })
  assert.equal(life.acquire(), true, '第一次必须新建')
  assert.equal(life.acquire(), false, '第二次只能复用')
  assert.equal(life.snapshot().active, true)
  // 反向变红：把 acquire 改成无条件 return true ⇒ 第二句红
  clock.advance(1000)
  assert.deepEqual(disposed, ['idle'], '空闲到点必须回收一次（不是两次）')
})

test('O-05 生命周期：忙时不回收，结算后重新起算', () => {
  const clock = fakeClock()
  const disposed = []
  const life = new RenderHostLifecycle({ idleMs: 1000, now: clock.now, schedule: clock.schedule, onDispose: (r) => disposed.push(r) })
  life.acquire()
  life.setBusy(true)
  clock.advance(5000)
  assert.deepEqual(disposed, [], '渲染中哪怕远超 idle 时长也不能回收')
  life.setBusy(false)
  clock.advance(999)
  assert.deepEqual(disposed, [], '结算后不足 idle 时长仍不能回收')
  clock.advance(1)
  assert.deepEqual(disposed, ['idle'])
  // 反向变红：把 rearm 里的 `this.busy` 判断删掉 ⇒ 第二段 advance(5000) 立刻红
})

test('O-05 生命周期：touch 续命（心跳能把空闲计时推后）', () => {
  const clock = fakeClock()
  const disposed = []
  const life = new RenderHostLifecycle({ idleMs: 1000, now: clock.now, schedule: clock.schedule, onDispose: (r) => disposed.push(r) })
  life.acquire()
  clock.advance(800)
  life.touch()
  clock.advance(800)
  assert.deepEqual(disposed, [], 'touch 过就还没到点')
  clock.advance(200)
  assert.deepEqual(disposed, ['idle'])
})

test('O-05 生命周期：dispose 幂等（窗口关了再关不能重复回调）', () => {
  const clock = fakeClock()
  let calls = 0
  const life = new RenderHostLifecycle({ idleMs: 0, now: clock.now, schedule: clock.schedule, onDispose: () => { calls += 1 } })
  life.acquire()
  life.dispose('window-closed')
  life.dispose('plugin-dispose')
  assert.equal(calls, 1, '第二次 dispose 必须空操作')
})

test('O-05 自报状态：未知 state 收敛成 error、detail 截断、selfCheck 归一', () => {
  resetRenderHostReport()
  const report = recordRenderHostReport({
    state: 'whatever-the-page-sent',
    detail: 'x'.repeat(999),
    selfCheck: { webCodecs: true, videoEncoder: 'yes', videoDecoder: true, hardwareConcurrency: 8.9 },
  }, 123)
  assert.equal(report.state, 'error', '未知状态不得透传')
  assert.equal(report.detail.length, 240, 'detail 必须截断（防页面把宿主内存写大）')
  assert.equal(report.selfCheck.webCodecs, true)
  assert.equal(report.selfCheck.videoEncoder, false, '非 true 的布尔字段一律 false')
  assert.equal(report.selfCheck.hardwareConcurrency, 8, '核数取整')
  assert.equal(lastRenderHostReport().at, 123)
  resetRenderHostReport()
  assert.equal(lastRenderHostReport(), undefined, 'reset 后必须为空（窗口重建不能读到上一窗口的状态）')
})

test('O-05 页面 HTML：只加载同源 bundle，不内联脚本，且带 CSP', () => {
  const html = renderHostHtml()
  assert.match(html, /<script type="module" src="\/canvas-studio\/render-host\.js"><\/script>/,
    'bundle 必须走同源绝对路径（相对路径在隐藏窗口里会解析到 /canvas-studio/ 下，404）')
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]{0,200}\S[\s\S]{0,200}<\/script>/.test(html),
    '不得内联脚本（CSP 只放行 self，内联会被静默拦掉）')
  assert.match(html, /Content-Security-Policy/, '必须带 CSP')
  assert.match(html, /id="state"/, '自报状态的挂载点必须在（S1 验收就靠它一眼看 idle）')
})

test('O-05 取 electron：三级退化顺序不能改（createRequire → mainModule → fallback）', () => {
  const src = read('src/render-host/window.ts')
  const atRequire = src.indexOf("req('electron')")
  const atMain = src.indexOf("main.require('electron')")
  const atFallback = src.indexOf('if (fallback !== undefined)')
  assert.ok(atRequire > 0 && atMain > atRequire && atFallback > atMain,
    `退化链顺序错乱：createRequire=${atRequire} mainModule=${atMain} fallback=${atFallback}`)
  // 真机 R1 已证前两级都通；这一条守的是「以后换宿主时别把退化链砍掉」。
  const fake = { app: { getVersion: () => 'fake' } }
  assert.ok(resolveElectron(fake) !== undefined, '注入 fallback 时必须取到 electron')
})

test('O-05 窗口参数：隐藏 + 场景节流关闭 + 沙箱/隔离（三条缺一条就白做）', () => {
  const src = read('src/render-host/window.ts')
  // 同样要防「注释喂饱正则」：锚到 4 空格缩进的真实选项行，而不是全文随便一处 `show:false`。
  assert.match(src, /^ {4}show:\s*false,/m, '窗口必须隐藏（可见窗口会闪 + 抢占焦点）')
  // 断言必须**锁在 webPreferences 块内**：文件头注释里也写着 `backgroundThrottling:false`，
  // 全文正则会被注释喂饱 —— 变异成 `true` 照样绿（第一版就踩了这个假绿）。
  const prefs = src.match(/webPreferences:\s*\{([\s\S]{0,800}?)\n\s{4}\}/)
  assert.ok(prefs !== null, '必须显式声明 webPreferences 块')
  const block = prefs[1]
  assert.match(block, /backgroundThrottling:\s*false/, 'backgroundThrottling:false 是整条方案的地基（O-04 Q2）')
  assert.match(block, /contextIsolation:\s*true/, 'contextIsolation 必须开')
  assert.match(block, /sandbox:\s*true/, 'sandbox 必须开')
  assert.match(block, /nodeIntegration:\s*false/, 'nodeIntegration 必须关')
  assert.match(src, /setBackgroundThrottling\?\.\(false\)/, '运行时再喊一次，防别的插件改回默认')
  // 反向变红：把块内的 backgroundThrottling 改成 true ⇒ 本用例红（真机表现是「渲染卡到超时」）
})

test('O-05 不许在模块顶层 await app.whenReady()（ESM 入口会死锁）', () => {
  for (const file of ['src/render-host/window.ts', 'src/render-host/main.ts']) {
    const src = read(file)
    assert.ok(!/^\s*await\s+app\.whenReady\s*\(/m.test(src),
      `${file} 出现顶层 await app.whenReady() —— ESM 入口会与 Electron 的 ready 事件互相等死`)
  }
})

test('O-05 三条路由已接线（页面 / bundle / 自报状态）', () => {
  const src = read('src/routes.ts')
  for (const route of ['/canvas-studio/render-host', '/canvas-studio/render-host.js', '/canvas-studio/render-host/status']) {
    assert.ok(src.includes(`'${route}'`), `缺少路由 ${route}`)
  }
  assert.match(src, /RENDER_HOST_BUNDLE_FILE/, 'bundle 必须真的去读构建产物')
  assert.match(src, /recordRenderHostReport\(body\)/, '状态路由必须落到唯一存储实现')
  assert.match(src, /disposeRenderHost\('plugin-dispose'\)/, '插件卸载必须销毁窗口（否则进程里留个孤儿隐藏窗口）')
})
