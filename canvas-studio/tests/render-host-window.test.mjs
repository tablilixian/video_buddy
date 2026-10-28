/**
 * RenderHost 窗口的**创建契约**（P0-5）。
 *
 * 这一层此前零覆盖，代价是：主窗口 `persist:dsh-desktop-renderer` 与隐藏窗口默认 session
 * 是两套互不可见的 cookie 存储，隐藏窗口的每个请求都吃到宿主准入闸的 `403 forbidden`，
 * 而 `loadURL` 把 403 也算「加载成功」⇒ 建窗 12 次、自报 0 次、日志一行不写。
 *
 * 断言重点不是「代码里有这行字」，而是失败时会变红的四件事：
 * 1. 借到宿主 session 时，构造参数里必须**真的有** session；
 * 2. 显式 partition 与借来的 session 互斥（两个都给会让 Electron 行为不确定）；
 * 3. 页面加载完必须把 body 文字打进日志（白屏/forbidden 才有痕迹可查）；
 * 4. 报警文案必须区分「从未自报」与「报了 error」（后者是页面自己的判断，处置不同）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { ensureRenderHost, disposeRenderHost } from '../lib/render-host/window.js'
import { recordRenderHostReport, resetRenderHostReport } from '../lib/render-host/status.js'

/** 最小 BrowserWindow 桩：记录构造参数，事件按名分发，可主动触发。 */
function fakeElectron(options = {}) {
  const created = []
  const hosts = options.hosts ?? []
  const jsResult = options.jsResult
  class FakeWindow {
    constructor(opts) {
      this.opts = opts
      this.destroyed = false
      this.handlers = new Map()
      this.webContents = {
        session: opts?.webPreferences?.session,
        getURL: () => 'http://127.0.0.1:43120/',
        setBackgroundThrottling: () => {},
        on: (event, fn) => {
          const list = this.handlers.get(`wc:${event}`) ?? []
          list.push(fn)
          this.handlers.set(`wc:${event}`, list)
        },
        executeJavaScript: jsResult === undefined
          ? undefined
          : () => Promise.resolve(jsResult),
      }
      created.push(this)
    }
    loadURL() { return Promise.resolve() }
    destroy() { this.destroyed = true }
    isDestroyed() { return this.destroyed }
    on(event, fn) {
      const list = this.handlers.get(event) ?? []
      list.push(fn)
      this.handlers.set(event, list)
    }
    emit(event, ...args) {
      for (const fn of this.handlers.get(event) ?? []) fn({}, ...args)
    }
    emitWc(event, ...args) {
      for (const fn of this.handlers.get(`wc:${event}`) ?? []) fn({}, ...args)
    }
  }
  FakeWindow.getAllWindows = () => hosts
  return { electron: { BrowserWindow: FakeWindow, app: { getVersion: () => '43.4.0' } }, created }
}

/** 每个用例收尾都要拆窗口：`ensureRenderHost` 是进程级单例。 */
function teardown() {
  disposeRenderHost('test')
  resetRenderHostReport()
}

test('P0-5①：没有显式分区时，借宿主窗口的 session 建窗', () => {
  teardown()
  const hostSession = { name: 'persist:dsh-desktop-renderer' }
  const hostWindow = {
    isDestroyed: () => false,
    webContents: { session: hostSession, getURL: () => 'http://127.0.0.1:43120/' },
  }
  const { electron, created } = fakeElectron({ hosts: [hostWindow] })
  const lines = []
  const handle = ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    electron,
    log: (m) => lines.push(m),
  })
  assert.ok(handle !== undefined, '应当建出窗口')
  assert.equal(created.length, 1)
  const wp = created[0].opts.webPreferences
  assert.equal(wp.session, hostSession, '必须把宿主 session 传进 webPreferences')
  assert.equal(wp.partition, undefined, '借 session 时不能再给 partition（两者互斥）')
  assert.ok(lines.some((l) => l.includes('复用宿主 session')), `日志要写明借到了：${lines.join(' | ')}`)
  teardown()
})

test('P0-5②：显式 partition 优先，且不再传 session', () => {
  teardown()
  const hostWindow = {
    isDestroyed: () => false,
    webContents: { session: { name: 'host' }, getURL: () => '' },
  }
  const { electron, created } = fakeElectron({ hosts: [hostWindow] })
  const lines = []
  ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    partition: 'persist:explicit',
    electron,
    log: (m) => lines.push(m),
  })
  const wp = created[0].opts.webPreferences
  assert.equal(wp.partition, 'persist:explicit')
  assert.equal(wp.session, undefined, '显式分区时不能同时塞 session')
  teardown()
})

test('P0-5③：取不到宿主 session 时必须明说「将一律 403」', () => {
  teardown()
  const { electron, created } = fakeElectron({ hosts: [] })
  const lines = []
  ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    electron,
    log: (m) => lines.push(m),
  })
  assert.equal(created[0].opts.webPreferences.session, undefined)
  assert.ok(
    lines.some((l) => l.includes('一律 403')),
    `退化到默认 session 却没有警告：${lines.join(' | ')}`,
  )
  teardown()
})

test('P0-5④：页面加载完把 body 文字与 __csRenderHost 是否定义写进日志', async () => {
  teardown()
  const { electron, created } = fakeElectron({
    hosts: [],
    jsResult: { ready: false, text: 'forbidden' },
  })
  const lines = []
  ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    electron,
    log: (m) => lines.push(m),
  })
  created[0].emitWc('did-finish-load')
  await new Promise((r) => setTimeout(r, 30))
  const line = lines.find((l) => l.includes('页面已加载'))
  assert.ok(line !== undefined, `没有页面加载自证：${lines.join(' | ')}`)
  assert.match(line, /__csRenderHost=未定义/u)
  assert.match(line, /forbidden/u, `body 文字没进日志：${line}`)
  teardown()
})

test('P0-5⑤：报警区分「从未自报」与「报了 error」', async () => {
  teardown()
  const { electron } = fakeElectron({ hosts: [] })
  const lines = []
  ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    electron,
    firstReportWarnMs: 20,
    log: (m) => lines.push(m),
  })
  await new Promise((r) => setTimeout(r, 60))
  const warn = lines.find((l) => l.includes('仍不可接管'))
  assert.ok(warn !== undefined, `没有报警：${lines.join(' | ')}`)
  assert.match(warn, /从未收到任何自报/u, '无自报时不能写成「上报了 error」')
  teardown()

  // 第二段：真报了一次 error ⇒ 文案要带出 detail（页面的判断，处置与「没自报」不同）
  const second = fakeElectron({ hosts: [] })
  const lines2 = []
  recordRenderHostReport({ state: 'error', detail: '本机不支持 WebCodecs' })
  ensureRenderHost({
    url: 'http://127.0.0.1:43120/canvas-studio/render-host',
    electron: second.electron,
    firstReportWarnMs: 20,
    log: (m) => lines2.push(m),
  })
  await new Promise((r) => setTimeout(r, 60))
  const warn2 = lines2.find((l) => l.includes('仍不可接管'))
  assert.ok(warn2 !== undefined)
  assert.match(warn2, /状态是 error/u, `应指出状态：${warn2}`)
  assert.match(warn2, /本机不支持 WebCodecs/u, `应带出 detail：${warn2}`)
  teardown()
})
