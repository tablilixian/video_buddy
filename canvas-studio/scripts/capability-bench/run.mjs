/**
 * 能力基准 · 驱动（唯一入口）。
 *
 * 一条命令跑完：bundle → 静态服务 → Electron → renderMediaOnWeb → 5 条硬检查
 *              → contact sheet → verdict.json / README.md / source.json / probe.mjs → repo 内索引。
 *
 * 用法：
 *   node scripts/capability-bench/run.mjs --only=10
 *   node scripts/capability-bench/run.mjs --only=10 --repeat=2          # 做 H4 可复现比对
 *   node scripts/capability-bench/run.mjs --only=10 --window=hidden     # 换窗口档
 *   node scripts/capability-bench/run.mjs --only=10 --flags=CanvasDrawElement   # html-in-canvas
 *   node scripts/capability-bench/run.mjs --only=10 --bundle-only       # 只验证能打包（30–60s）
 *   node scripts/capability-bench/run.mjs --all                         # 跑所有 status=done 的项
 *
 * 硬性纪律（都在这里强制，不靠人记）：
 *   - spawn Electron 前删掉 ELECTRON_RUN_AS_NODE（§11.2 E4）；
 *   - 判定"这次真渲了"只看**文件 mtime 是否晚于本次开始**，不看它打印的清单（§11.3 G4）；
 *   - 产物落 repo 外，repo 内只写索引（D1）。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runChecks, contactSheet } from './lib/checks.mjs'
import { launchRenderer, parseEvents } from './lib/electron.mjs'
import { writeIndex, writeReport } from './lib/report.mjs'
import { startBenchServer } from './lib/server.mjs'
import { POOL_SOURCES, SPECS, getSpec } from './specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANVAS_ROOT = resolve(HERE, '..', '..')
const REPO = resolve(CANVAS_ROOT, '..')
const ENTRY = join(HERE, 'compositions', 'entry.tsx')
const BUNDLE_DIR = join(HERE, '.bundle')
const FONT_DIR = join(CANVAS_ROOT, 'assets', 'fonts')
const ELECTRON_APP = join(HERE, 'electron')
const INDEX_FILE = join(CANVAS_ROOT, 'docs', 'plans', 'remotion-capability-20261029', 'INDEX.md')

const log = (...args) => console.log('[bench]', ...args)
const ok = (label) => console.log('[bench] ✅', label)
const warn = (label) => console.log('[bench] ⚠️', label)

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const hasFlag = (name) => process.argv.includes(`--${name}`)

const stamp = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

async function buildBundle() {
  const { bundle } = await import('@remotion/bundler')
  log('打包 bundle（webpack，一次性；10 条共用）…')
  const started = Date.now()
  await bundle({
    entryPoint: ENTRY,
    outDir: BUNDLE_DIR,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...(config.resolve ?? {}),
        extensionAlias: { ...((config.resolve && config.resolve.extensionAlias) || {}), '.js': ['.ts', '.tsx', '.js'] },
      },
    }),
  })
  ok(`bundle 完成（${Math.round((Date.now() - started) / 1000)}s）`)
}

function electronBinary() {
  const requireFromDesktop = createRequire(join(REPO, 'dsh-plugin-desktop', 'package.json'))
  return requireFromDesktop('electron')
}

function sha256Prefix(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
}

async function renderOnce({ spec, runDir, outName, window, flags, durationInFrames, timeoutMs, label, htmlOverride }) {
  const { server, url } = await startBenchServer({
    bundleDir: BUNDLE_DIR,
    outDir: runDir,
    pool: Object.fromEntries(spec.assets.filter((k) => POOL_SOURCES[k]).map((k) => [k, POOL_SOURCES[k]])),
    fontDir: FONT_DIR,
    config: {
      id: spec.id,
      outName,
      width: spec.__width,
      height: spec.__height,
      fps: spec.__fps,
      durationInFrames,
      stills: spec.__stills,
      window,
      // R1：html-in-canvas 走整帧 DOM 截图，绕过 CSS 白名单。默认 false，仅在 spec 声明时开。
      // `--html=0/1` 可临时覆盖，用来跑"开/不开"的 A/B 对照（同一份合成）。
      allowHtmlInCanvas: htmlOverride === null ? spec.allowHtmlInCanvas === true : htmlOverride,
    },
  })

  const target = join(runDir, outName)
  // 尽力清掉旧文件：去系统目录（VideoOut 在 repo 外）时受管 shell 会 EPERM 拒 unlink，
  // 所以**不能依赖删除**——真正的判据是下面的 mtime 闸门。
  try {
    if (existsSync(target)) rmSync(target, { force: true })
  } catch {
    warn(`旧产物无法删除（沙箱拒绝）：${target}；改由 mtime 判定本次是否真渲`)
  }
  const startedAt = Date.now()

  try {
    const { code, lines } = await launchRenderer({
      binary: electronBinary(),
      url,
      window,
      flags,
      timeoutMs,
    })
    const events = parseEvents(lines)
    const done = events.find((e) => e.step === 'render:done')
    const error = events.find((e) => e.step === 'error')
    if (error) throw new Error(`页面报错：${error.message}`)
    if (code !== 0 || !done) throw new Error(`渲染未完成（exit=${code}）`)

    // C11 铁律：只信 mtime
    if (!existsSync(target)) throw new Error(`未产出 ${outName}`)
    const mtime = statSync(target).mtimeMs
    if (mtime < startedAt - 1000) throw new Error(`${outName} 是历史文件（mtime 早于本次开始），本次渲染其实失败了`)

    return { events, done, lines, target, ms: done.ms, bytes: done.bytes }
  } finally {
    server.close()
  }
}

async function runOne(spec, options) {
  const { outRoot, window, flags, repeat, timeoutMs, htmlOverride } = options
  // probe.mjs 会把 --out 指到条目目录本身；此时不要再套一层 `NN-axis`
  const itemName = `${spec.id}-${spec.axis}`
  const runDir = basename(outRoot) === itemName ? outRoot : join(outRoot, itemName)
  mkdirSync(runDir, { recursive: true })

  spec.__width = 1920
  spec.__height = 1080
  spec.__fps = 30
  const durationInFrames = spec.durationInFrames ?? 300
  // 每条都给首/中/末三张静帧（成本可忽略：同一次 Electron 会话里连渲），便于不看成片也能目视
  spec.__stills = spec.stills ?? [0, Math.floor((durationInFrames - 1) / 2), durationInFrames - 1]

  log(`— ${spec.id} ${spec.title} → ${runDir}`)
  const first = await renderOnce({
    spec,
    runDir,
    outName: `cap${spec.id}.mp4`,
    window,
    flags,
    durationInFrames,
    timeoutMs,
    label: 'run-1',
    htmlOverride,
  })

  let secondTarget = null
  if (repeat >= 2) {
    log('第二次渲染（H4 可复现比对）…')
    const second = await renderOnce({
      spec,
      runDir,
      outName: `cap${spec.id}-run2.mp4`,
      window,
      flags,
      durationInFrames,
      timeoutMs,
      label: 'run-2',
      htmlOverride,
    })
    secondTarget = second.target
  }

  const envEvent = first.events.find((e) => e.step === 'env') ?? {}
  const codecEvent = first.events.find((e) => e.step === 'codecs') ?? {}
  const canRender = first.events.find((e) => e.step === 'canRender') ?? {}

  const checks = runChecks({
    file: first.target,
    file2: secondTarget,
    expect: spec.expect,
    spec: { fps: spec.__fps, durationInFrames, width: spec.__width, height: spec.__height },
    workDir: join(runDir, 'frames'),
  })

  const sheet = contactSheet(first.target, durationInFrames, join(runDir, 'frames', 'contact.png'))
  log(`contact sheet：${sheet.picks.join(', ')}`)

  const assets = spec.assets
    .filter((key) => POOL_SOURCES[key])
    .map((key) => {
      const path = POOL_SOURCES[key]
      return existsSync(path)
        ? { key, path, bytes: statSync(path).size, sha256: sha256Prefix(path) }
        : { key, path, bytes: null, sha256: null, missing: true }
    })

  const pkg = JSON.parse(readFileSync(join(CANVAS_ROOT, 'package.json'), 'utf8'))
  const verdict = writeReport({
    spec,
    outDir: runDir,
    run: {
      outName: `cap${spec.id}.mp4`,
      width: spec.__width,
      height: spec.__height,
      fps: spec.__fps,
      durationInFrames,
      ms: first.done.ms,
      msPerFrame: first.done.msPerFrame,
      window,
      flags: flags.join(','),
      runtime: {
        chromeMajor: envEvent.chromeMajor ?? null,
        webgl2: envEvent.webgl2 ?? null,
        fontsReady: envEvent.fontsReady ?? null,
        videoCodecs: codecEvent.video ?? null,
        audioCodecs: codecEvent.audio ?? null,
        canRender: canRender.value ?? null,
        remotionVersion: pkg.dependencies?.remotion ?? null,
      },
    },
    checks,
    assets,
    entryRel: relative(REPO, ENTRY),
    benchRun: join(HERE, 'run.mjs'),
  })

  return { spec, runDir, verdict, checks }
}

async function main() {
  const only = arg('only', '')
  const all = hasFlag('all')
  const outRoot = arg('out', join('/Users/wl/Desktop/job/VideoOut', `remotion-capability-${stamp()}`))
  const window = arg('window', 'visible')
  const repeat = Number(arg('repeat', '1'))
  const timeoutMs = Number(arg('timeout', '600000'))
  const flags = arg('flags', '').split(',').map((s) => s.trim()).filter(Boolean)
  const htmlArg = arg('html', '')
  const htmlOverride = htmlArg === '1' ? true : htmlArg === '0' ? false : null

  if (!only && !all) {
    console.log('用法：--only=NN | --all [--repeat=2] [--window=hidden] [--flags=CanvasDrawElement] [--bundle-only]')
    console.log(`已注册（status=done）：${SPECS.filter((s) => s.status === 'done').map((s) => `${s.id}-${s.axis}`).join(', ')}`)
    process.exitCode = 1
    return
  }

  await buildBundle()
  if (hasFlag('bundle-only')) {
    ok('只验打包通过（--bundle-only）')
    return
  }

  const targets = all
    ? SPECS.filter((s) => s.status === 'done').map((s) => s.id)
    : only.split(',').map((s) => s.trim()).filter(Boolean)

  mkdirSync(outRoot, { recursive: true })
  log(`产物根目录：${outRoot}（repo 外；mp4 不进 git）`)

  const results = []
  for (const id of targets) {
    const spec = getSpec(id)
    if (spec.status === 'todo') {
      warn(`${id} 尚未实现（status=todo）：请在 compositions/ 加 ${id}-*.tsx 并在 entry.tsx 注册`)
      results.push({ id, title: spec.title, status: 'todo', autoScore: null, dir: null })
      continue
    }
    const result = await runOne(spec, { outRoot, window, flags, repeat, timeoutMs, htmlOverride })
    results.push({
      id,
      title: spec.title,
      status: spec.status,
      autoScore: result.checks.autoScore,
      outFile: `cap${id}.mp4`,
      dir: result.runDir,
    })
    ok(`${id} 完成：autoScore ${result.checks.autoScore}/5，硬检查未过 ${result.checks.hardFail.join('、') || '无'}`)
  }

  mkdirSync(dirname(INDEX_FILE), { recursive: true })
  writeIndex(INDEX_FILE, results)
  ok(`索引已写：${INDEX_FILE}`)

  for (const r of results) {
    console.log(`  ${r.id}  ${r.status.padEnd(10)} autoScore=${r.autoScore ?? '—'}  ${r.dir ?? ''}`)
  }
}

main().catch((error) => {
  console.error('[bench] ❌', error && error.message ? error.message : error)
  process.exitCode = 1
})
