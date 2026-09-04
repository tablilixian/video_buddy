#!/usr/bin/env node
/**
 * package.mjs — Build VideoBuddy installers/artifacts for macOS and Windows.
 *
 * One command builds the package AND prints where it landed plus package metadata:
 *
 *   node scripts/package.mjs                # auto-detect current platform
 *   node scripts/package.mjs mac            # unsigned universal macOS DMG
 *   node scripts/package.mjs win            # unsigned Windows x64 NSIS installer
 *   node scripts/package.mjs win-portable   # unsigned Windows x64 portable ZIP
 *
 * Optional flags:
 *   --skip-build   skip the canvas-studio + desktop rebuild (use only when you
 *                  already built; otherwise the packaged code is stale).
 *   --run-gate     also run the full package preflight gate instead of skipping it.
 *   --no-mirror    do not default the npmmirror binary mirrors.
 *
 * Notes:
 *   - macOS artifacts must be built on a native macOS host; Windows on a native
 *     Windows host (matching the upstream package scripts' host constraints).
 *   - On the China network, electron/electron-builder binaries need mirrors; when
 *     ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR are unset this script
 *     defaults them to npmmirror.com so the command works out of the box.
 *   - Desktop `dist:*` scripts do NOT rebuild `dsh-plugin-desktop`; this wrapper
 *     always rebuilds canvas-studio + dsh-plugin-desktop first so the packaged
 *     app embeds the latest source (can be skipped with --skip-build).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const desktopRoot = join(repoRoot, 'dsh-plugin-desktop')

const HELP = `Usage: node scripts/package.mjs [target] [--skip-build] [--run-gate] [--no-mirror]

Targets:
  mac            unsigned universal macOS DMG (dist/mac-smoke)
  win            unsigned Windows x64 NSIS installer (dist)
  win-portable   unsigned Windows x64 portable ZIP (dist)
  (default)      auto-detect from the current platform (darwin -> mac, win32 -> win)

Flags:
  --skip-build   skip the canvas-studio + desktop rebuild
  --run-gate     run the full package preflight gate (skipped by default)
  --no-mirror    don't default ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR
`

/** Run a child process inheriting stdio; bail with a clear message on failure. */
function run(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' })
  if (result.error) {
    console.error(`✗ failed to spawn ${cmd}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`✗ command exited with ${result.status}: ${cmd} ${args.join(' ')}`)
    process.exit(result.status)
  }
}

/** Node version gate shared by the upstream package scripts (22.19+ or 24.x). */
function checkNode() {
  const match = /^v?(\d+)\.(\d+)\./u.exec(process.version)
  const major = Number(match?.[1])
  const minor = Number(match?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    console.error(`✗ need Node ^22.19.0 or >=24.0.0; current ${process.version}`)
    process.exit(1)
  }
}

function humanSize(bytes) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 2)} ${units[exp]}`
}

function info() {
  const raw = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8'))
  return {
    version: raw.version,
    productName: raw.build?.productName ?? raw.name,
    appId: raw.build?.appId ?? '(none)',
  }
}

/** Absolute package.json version (fallback: description without 'v'). */
function version() {
  return info().version
}

const TARGETS = {
  mac: {
    name: 'macOS universal DMG',
    host: 'darwin',
    distScript: 'dist:mac-smoke',
    outDir: join(desktopRoot, 'dist', 'mac-smoke'),
    patterns: [() => `VideoBuddy-${version()}-universal.dmg`],
  },
  win: {
    name: 'Windows x64 NSIS installer',
    host: 'win32',
    distScript: 'dist:win',
    outDir: join(desktopRoot, 'dist'),
    patterns: [() => `VideoBuddy-${version()}-x64-Setup.exe`, () => join('win-unpacked', 'VideoBuddy.exe')],
  },
  'win-portable': {
    name: 'Windows x64 portable ZIP',
    host: 'win32',
    distScript: 'dist:win-portable',
    outDir: join(desktopRoot, 'dist'),
    patterns: [() => `VideoBuddy-${version()}-x64-Portable.zip`],
  },
}

/** Resolve target name, applying platform auto-detection. */
function resolveTarget(arg) {
  if (arg === undefined || arg === null || arg === '') {
    const auto = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : null
    if (!auto) {
      console.error(`✗ cannot auto-detect platform on ${process.platform}; pass mac|win|win-portable`)
      process.exit(1)
    }
    console.log(`==> auto-detected target: ${auto} (host ${process.platform})`)
    return auto
  }
  if (!(arg in TARGETS)) {
    console.error(`✗ unknown target "${arg}"\n`)
    console.error(HELP)
    process.exit(1)
  }
  const target = TARGETS[arg]
  if (process.platform !== target.host) {
    console.error(`✗ ${arg} requires a native ${target.host} host; current host is ${process.platform}`)
    process.exit(1)
  }
  return arg
}

function defaultMirrors(env) {
  if (env.ELECTRON_MIRROR === undefined || env.ELECTRON_MIRROR === '') {
    env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
    console.log('==> defaulted ELECTRON_MIRROR -> npmmirror.com (change with --no-mirror / env)')
  }
  if (env.ELECTRON_BUILDER_BINARIES_MIRROR === undefined || env.ELECTRON_BUILDER_BINARIES_MIRROR === '') {
    env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
    console.log('==> defaulted ELECTRON_BUILDER_BINARIES_MIRROR -> npmmirror.com (change with --no-mirror / env)')
  }
}

/** Collect produced artifact paths that currently exist on disk. */
function collectArtifacts(target) {
  const found = []
  for (const pattern of target.patterns) {
    const rel = pattern()
    const abs = join(target.outDir, rel)
    if (existsSync(abs)) found.push(abs)
  }
  // Fall back to a broad scan of the output dir for our well-known names.
  if (found.length === 0 && existsSync(target.outDir)) {
    const names = readdirSync(target.outDir)
    for (const name of names) {
      if (/VideoBuddy.*\.(dmg|exe|zip)$/u.test(name)) found.push(join(target.outDir, name))
    }
  }
  return found
}

function main() {
  const args = process.argv.slice(2)
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const skipBuild = flags.has('--skip-build')
  const runGate = flags.has('--run-gate')
  const disableMirror = flags.has('--no-mirror')
  const targetArg = args.find(a => !a.startsWith('--'))
  if (flags.has('--help') || flags.has('-h')) {
    console.log(HELP)
    return
  }

  checkNode()

  // light prerequisites (AGENTS.md): submodule + workspace deps present
  if (!existsSync(join(repoRoot, 'deepseek-harness', 'src', 'index.ts'))) {
    console.log('==> initializing upstream submodule (first run, needs network)...')
    run('git', ['submodule', 'update', '--init', '--recursive'], repoRoot, process.env)
  }
  if (!existsSync(join(repoRoot, 'node_modules', '.bin'))) {
    console.log('==> installing workspace dependencies (first run, needs network)...')
    run('corepack', ['yarn', 'install', '--immutable'], repoRoot, process.env)
  }

  const targetKey = resolveTarget(targetArg)
  const target = TARGETS[targetKey]
  const meta = info()

  const env = { ...process.env }
  if (!disableMirror) defaultMirrors(env)
  env.DSH_PACKAGE_CHECK_ALREADY_RAN = runGate ? '0' : '1'
  if (runGate) delete env.DSH_PACKAGE_CHECK_ALREADY_RAN

  if (skipBuild) {
    console.log('==> --skip-build: skipping canvas-studio + desktop rebuild')
  } else {
    console.log('==> building canvas-studio (compile latest source)...')
    run('corepack', ['yarn', 'workspace', 'canvas-studio', 'build'], repoRoot, env)
    console.log('==> building dsh-plugin-desktop (bundle canvas lib into app)...')
    run('corepack', ['yarn', 'workspace', 'dsh-plugin-desktop', 'build'], repoRoot, env)
  }

  console.log(`==> packaging ${target.name} (${target.distScript})...`)
  run('corepack', ['yarn', target.distScript], repoRoot, env)

  const artifacts = collectArtifacts(target)
  const when = new Date().toISOString()

  console.log('\n=============================================')
  console.log('  打包完成 / Package complete')
  console.log('=============================================')
  console.log(`  目标 Target      : ${target.name}`)
  console.log(`  版本 Version      : ${meta.version}`)
  console.log(`  产品 Product      : ${meta.productName}`)
  console.log(`  AppId            : ${meta.appId}`)
  console.log(`  架构 Arch         : ${target.host === 'darwin' ? 'universal (x64+arm64)' : 'x64'}`)
  console.log(`  时间 Time         : ${when}`)
  console.log('  -------------------------------------------')
  if (artifacts.length === 0) {
    console.log('  产物 Artifacts    : (none found — see output dir)')
  } else {
    console.log('  产物 Artifacts:')
    for (const abs of artifacts) {
      let s = ''
      try { s = humanSize(statSync(abs).size) } catch { /* ignore */ }
      console.log(`    ${abs}`)
      console.log(`      size: ${s}`)
    }
  }
  console.log(`  输出目录 Output   : ${target.outDir}`)
  console.log('=============================================\n')
}

main()
