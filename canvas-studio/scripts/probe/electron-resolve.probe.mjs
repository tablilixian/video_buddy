// R1 探针：真机 App 里（Host 与 Electron main 同进程）canvas-studio 的 Host 模块
// 能不能取到 `electron`？
//
// 背景：REQ-034 O-04 的 Q1 只验到「独立 Electron main」这一层。真实路径上，
// dsh 会先 installProfilePackageResolver() 装两层钩子（ESM resolve hook +
// CommonJS `_resolveFilename`），再从 profile 里载入插件包 —— 需要在**这个前提下**
// 复验，否则 O-05 RenderHost 的窗口创建可能在真机上直接炸。
//
// 运行（Electron main 里跑，不是 node）：
//   env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 \
//     ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/electron-resolve.probe.mjs
//
// 退出码：三种机制**全部**失败 ⇒ 1。

import { app } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// 逐步骤落盘：真机上应用可能停在任意一步（或根本不退出），没有这一步日志就只能看空文件。
const stepLog = '/tmp/r1-steps.log'
const step = (tag, extra) => {
  try {
    appendFileSync(stepLog, `${new Date().toISOString()} ${tag}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`)
  } catch { /* 日志失败不影响判定 */ }
}
step('boot', { electron: process.versions.electron, type: process.type ?? null })

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')
const outDir = '/tmp/cs-r1-probe'
const probeDir = join(repoRoot, '.probe-tmp')
const probeModulePath = join(probeDir, '__cs-electron-probe.mjs')

const canvasEntry = join(repoRoot, 'lib', 'index.js')

// 子模块：parentURL 落在 canvas-studio 包内（与 lib/index.js 同层级语义），
// 三种取 electron 的方式都从「插件自己的模块上下文」发起。
const CHILD_SOURCE = `
import { createRequire } from 'node:module'

const out = { file: import.meta.url, type: process.type ?? null }

const req = createRequire(import.meta.url)
try {
  const e = req('electron')
  out.cjs = { ok: true, version: e?.app?.getVersion?.() ?? null, exportCount: Object.keys(e ?? {}).length }
} catch (error) {
  out.cjs = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 240) }
}

try {
  const ns = await import('electron')
  const mod = ns?.default ?? ns
  out.esm = {
    ok: true,
    version: mod?.app?.getVersion?.() ?? null,
    hasDefault: ns?.default !== undefined,
    exportCount: Object.keys(ns ?? {}).length,
  }
} catch (error) {
  out.esm = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 240) }
}

try {
  const main = process.mainModule
  if (main === undefined) {
    out.mainModule = { ok: false, message: 'process.mainModule is undefined' }
  } else {
    const e = main.require('electron')
    out.mainModule = { ok: true, version: e?.app?.getVersion?.() ?? null }
  }
} catch (error) {
  out.mainModule = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 240) }
}

export default out
`

function writeChild() {
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(probeModulePath, CHILD_SOURCE, 'utf8')
}

async function loadChild(tag) {
  const url = pathToFileURL(probeModulePath).href + `?t=${tag}`
  step('child:start', { tag })
  try {
    const ns = await import(url)
    step('child:done', { tag })
    return ns.default
  } catch (error) {
    step('child:error', { tag, message: String(error?.message ?? error).slice(0, 160) })
    return { loadError: { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 400) } }
  }
}

/** 造一个最小的 profile 目录，给 installProfilePackageResolver 一个真实锚点。 */
function makeProfile() {
  const profileDir = join(outDir, 'profile')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'cs-r1-probe-profile',
    version: '0.0.0',
    dependencies: {},
  }, null, 2))
  return { profileDir, manifestUrl: pathToFileURL(join(profileDir, 'package.json')).href }
}

// ⚠️ 不能用顶层 `await app.whenReady()`：ESM main 的顶层 await 会阻塞模块求值，
// 而 Electron 要等入口模块求值完才 emit `ready` ⇒ 互相等死（真机实测：卡在 boot 后一动不动）。
// 正确写法：模块同步求值完，用 .then 接 ready。
async function main() {
  step('whenReady:done')

  const report = {
    env: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      processType: process.type ?? null,
    },
    canvasEntry,
    checks: {},
  }

  writeChild()
  step('child:written')

  // ① 未装 resolver：插件模块上下文的基线
  report.checks.baseline = await loadChild('baseline')

  // ② 装 dsh 的两层钩子后复验（真实前提）
  const { profileDir, manifestUrl } = makeProfile()
  report.profile = { dir: profileDir, manifestUrl }
  try {
    step('resolver:import')
    const mod = await import(pathToFileURL(join(repoRoot, '..', 'dsh-plugin-desktop', 'lib', 'module-resolution.js')).href)
    step('resolver:imported')
    const release = mod.installProfilePackageResolver(manifestUrl)
    report.resolver = { installed: true }
    report.checks.afterResolver = await loadChild('resolver')

    // ③ Host 入口本身能否在 Electron 里被 import（能否载入是第二道门槛）
    try {
      step('entry:import')
      const entry = await import(pathToFileURL(canvasEntry).href + '?t=' + Date.now())
      step('entry:imported')
      report.checks.entryImport = { ok: true, name: entry?.name ?? null, hasApply: typeof entry?.apply === 'function' }
    } catch (error) {
      report.checks.entryImport = { ok: false, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 300) }
    }

    release()
  } catch (error) {
    report.resolver = { installed: false, message: String(error?.message ?? error).slice(0, 300) }
  }

  // ④ 探针进程自身（parent = scripts/probe）的对照：证明差异来自「模块上下文」而非 Electron 能力
  const selfReq = createRequire(import.meta.url)
  try {
    const e = selfReq('electron')
    report.checks.selfContext = { ok: true, version: e?.app?.getVersion?.() ?? null }
  } catch (error) {
    report.checks.selfContext = { ok: false, message: String(error?.message ?? error).slice(0, 240) }
  }

  const pick = (block) => block ?? {}
  const b = pick(report.checks.baseline)
  const r = pick(report.checks.afterResolver)
  const allFailed = [b, r].every(
    (x) => x.loadError !== undefined
      || (x.cjs?.ok !== true && x.esm?.ok !== true && x.mainModule?.ok !== true),
  )

  step('report:write')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('=== R1 探针：Host 侧取 electron ===')
  console.log('electron', report.env.electron, '| process.type =', report.env.processType)
  console.log('resolver:', report.resolver)
  console.log('baseline        :', JSON.stringify(report.checks.baseline))
  console.log('afterResolver   :', JSON.stringify(report.checks.afterResolver))
  console.log('entryImport     :', JSON.stringify(report.checks.entryImport))
  console.log('selfContext     :', JSON.stringify(report.checks.selfContext))
  console.log('report →', join(outDir, 'report.json'))

  try { rmSync(probeDir, { recursive: true, force: true }) } catch { /* 沙箱可能拦，留着无害 */ }

  app.exit(allFailed ? 1 : 0)
}

step('whenReady:start')
app.whenReady().then(main).catch((error) => {
  step('fatal', { message: String(error?.message ?? error).slice(0, 300) })
  console.error(error)
  app.exit(1)
})
