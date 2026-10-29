#!/usr/bin/env node
/**
 * 能力探针 · 驱动（capability-bench/env）
 *
 * 起一个 127.0.0.1 静态页（WebCodecs/WebGPU 要求 secure context），spawn 仓库自带的
 * Electron 加载它、注入 page.js、收回 JSON，落盘并打一份人读摘要。
 *
 * 用法
 * ----
 *   node scripts/capability-bench/env/run.js                       # hidden + 不节流（RenderHost 形态）
 *   node scripts/capability-bench/env/run.js --window=visible
 *   node scripts/capability-bench/env/run.js --throttle=1          # 旧配置对照
 *   node scripts/capability-bench/env/run.js --no-sandbox          # 沙箱环境兜底
 *   node scripts/capability-bench/env/run.js --out=/tmp/env.json
 *
 * 只 kill 自己 spawn 的那个 Electron 进程；**绝不碰用户正在用的 dsh 实例**。
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..', '..', '..')
const DESKTOP_ROOT = resolve(PACKAGE_ROOT, '..', 'dsh-plugin-desktop')

function arg(name, fallback) {
  const prefix = '--' + name + '='
  const hit = process.argv.find((a) => a.startsWith(prefix))
  if (hit) return hit.slice(prefix.length)
  if (process.argv.includes('--' + name)) return '1'
  return fallback
}

const WINDOW_MODE = arg('window', 'hidden')
const THROTTLE = arg('throttle', '0') === '1' ? '1' : '0'
const NO_SANDBOX = arg('no-sandbox', '0') === '1'
const TIMEOUT_MS = Number(arg('timeout', '90000'))
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = resolve(arg('out', join(HERE, 'out', 'env-' + WINDOW_MODE + (THROTTLE === '1' ? '-throttled' : '') + '-' + stamp + '.json')))

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>capability probe</title></head>' +
  '<body style="margin:0;background:#111;color:#eee;font:14px sans-serif">probe</body></html>'

function electronBinary() {
  const requireFromDesktop = createRequire(join(DESKTOP_ROOT, 'package.json'))
  return requireFromDesktop('electron')
}

function startServer() {
  return new Promise((ready) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(HTML)
    })
    server.listen(0, '127.0.0.1', () => ready({ server, port: server.address().port }))
  })
}

function runElectron(url) {
  const binary = electronBinary()
  const env = { ...process.env, PROBE_URL: url, PROBE_WINDOW: WINDOW_MODE, PROBE_THROTTLE: THROTTLE }
  // 关键：父进程带的 ELECTRON_RUN_AS_NODE 会把 Electron 退化成纯 Node（拿不到 BrowserWindow）。
  delete env.ELECTRON_RUN_AS_NODE
  if (NO_SANDBOX) env.CSR_NO_SANDBOX = '1'
  const features = arg('features', '')
  if (features) env.PROBE_FEATURES = features
  const extraSwitch = arg('switch', '')
  if (extraSwitch) env.PROBE_SWITCH = extraSwitch

  return new Promise((done) => {
    const child = spawn(binary, [HERE], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const errs = []
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch (error) {
        void error
      }
      done(result)
    }
    const onData = (buffer) => {
      const text = buffer.toString()
      chunks.push(text)
      if (text.includes('__PROBE_JSON__')) finish({ ok: true, text: chunks.join('') })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (buffer) => errs.push(buffer.toString()))
    child.on('exit', (code) => finish({ ok: false, code, text: chunks.join(''), err: errs.join('') }))
    child.on('error', (error) => finish({ ok: false, code: -1, text: '', err: error.message }))
    const timer = setTimeout(() => finish({ ok: false, code: 'timeout', text: chunks.join(''), err: errs.join('') }), TIMEOUT_MS)
  })
}

function pickJson(text) {
  const line = text.split('\n').find((l) => l.startsWith('__PROBE_JSON__'))
  if (!line) return null
  try {
    return JSON.parse(line.slice('__PROBE_JSON__'.length))
  } catch (error) {
    return { parseError: String(error) }
  }
}

function summary(raw) {
  if (!raw) return '（无结果）'
  const p = raw.page || {}
  const gl = (x) => (x && x.ok ? (x.unmaskedRenderer || x.renderer || '?') : 'NO')
  const lines = []
  lines.push('模式          : ' + raw.mode + (raw.throttling ? ' + backgroundThrottling' : '') + '  visible=' + raw.visible)
  lines.push('版本          : electron ' + raw.app.electron + ' / chrome ' + raw.app.chrome + ' / ' + raw.app.platform)
  lines.push('WebGL1        : ' + gl(p.webgl1))
  lines.push('WebGL2        : ' + gl(p.webgl2))
  lines.push('WebGPU        : ' + (p.webgpu && p.webgpu.navigatorGpu ? (p.webgpu.adapter ? 'adapter ok ' + JSON.stringify(p.webgpu.adapter.info) : 'no adapter') : 'navigator.gpu 不存在'))
  lines.push('GPU 降级功能  : ' + JSON.stringify((raw.gpuFeatureStatus && { webgl: raw.gpuFeatureStatus.webgl, webgl2: raw.gpuFeatureStatus.webgl2, gpu_compositing: raw.gpuFeatureStatus.gpu_compositing }) || null))
  lines.push('2D 全帧捕获   : ' + JSON.stringify(p.canvasCapture))
  lines.push('编码器(视频)  : ' + JSON.stringify(p.encoders && p.encoders.video))
  lines.push('编码器(音频)  : ' + JSON.stringify(p.encoders && p.encoders.audio))
  lines.push('SVG 光栅化    : ' + JSON.stringify(p.svg))
  lines.push('定时器        : ' + JSON.stringify(p.timers))
  lines.push('解码/离屏     : ' + JSON.stringify(p.decoders))
  if (raw.pageError) lines.push('页面错误      : ' + raw.pageError)
  return lines.join('\n')
}

async function main() {
  const { server, port } = await startServer()
  const url = 'http://127.0.0.1:' + port + '/'
  const result = await runElectron(url)
  server.close()

  const raw = pickJson(result.text)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ stamp, window: WINDOW_MODE, throttle: THROTTLE === '1', noSandbox: NO_SANDBOX, features: arg('features', ''), extraSwitch: arg('switch', ''), raw }, null, 2))

  console.log(summary(raw))
  if (!raw) {
    console.log('--- 原始输出 ---')
    console.log(result.text.slice(0, 4000))
    console.log(result.err ? result.err.slice(0, 2000) : '')
  }
  console.log('\n落盘: ' + OUT)
  process.exitCode = raw ? 0 : 1
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error))
  process.exitCode = 1
})
