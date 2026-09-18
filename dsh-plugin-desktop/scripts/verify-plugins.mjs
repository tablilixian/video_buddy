/** Headless plugin-activation probe: boots the real desktop composition and
 * asserts the bundled plugins actually came up — not just that the loader
 * exited cleanly (failOnStartupError:false can swallow activation failures).
 *
 * Verifies, in order:
 *   1. MemOS (`memos-local-memory` row) registered its `memos_*` tools on ctx.tools
 *   2. Hybrid provider (`web-search-hybrid` row) is pinned by the web seam and
 *      serves one real keyless search + one real keyless fetch
 *   3. MemOS created its runtime data directory under $DSH_HOME
 *
 * Run: yarn workspace dsh-plugin-desktop verify:plugins
 * Exits non-zero on the first failed assertion; prints a PASS/FAIL list.
 */

import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'

const BIN_NAME = 'dsh-plugin-desktop-plugins-probe'
const BROWSER_ACCESS = Object.freeze({
  ordinaryBrowserEnabled: false,
  rendererHeader: Object.freeze({
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 1).toString('base64url'),
  }),
})
const MEMOS_TOOLS = [
  'memos_search',
  'memos_get',
  'memos_timeline',
  'memos_environment',
  'memos_skill_list',
  'memos_skill_get',
]
const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-plugins-'))
// MemOS resolves its runtime root from $DSH_HOME (config.home is ''), so the
// probe writes into its own temp home instead of the user's real ~/.dsh.
process.env.DSH_HOME = home
let ctx
let pnpmRuntime
let releasePackageResolver

const results = []
function report(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// The desktop host runs under the ELECTRON runtime, and better-sqlite3 is
// compiled for Electron's ABI — so the probe must run there too, or MemOS
// fails to open its database for the mirror-image reason. Re-spawn under
// `ELECTRON_RUN_AS_NODE=1` when started with plain Node.
if (process.versions.electron === undefined) {
  const requireFromDesktop = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
  const electronBin = requireFromDesktop('electron')
  const rerun = spawnSync(electronBin, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })
  process.exit(rerun.status ?? 1)
}

try {
  const packageRoot = new URL('../', import.meta.url)
  // 0. ABI precheck: better-sqlite3 must load under the ELECTRON runtime (the
  // desktop host runs there, not under plain Node). A Node-ABI build fails to
  // dlopen and MemOS silently degrades (failOnStartupError:false). This check
  // catches the regression right after any `yarn install`.
  {
    const requireFromDesktop = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
    const electronBin = requireFromDesktop('electron')
    const probe = spawnSync(electronBin, ['-e', "console.log('ABI', process.versions.modules); require('better-sqlite3')"], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: fileURLToPath(packageRoot),
      encoding: 'utf8',
      timeout: 30_000,
    })
    report(
      'better-sqlite3 loads under Electron ABI',
      probe.status === 0,
      probe.status === 0
        ? `Electron ABI ${probe.stdout?.match(/ABI (\d+)/)?.[1] ?? 'ok'}`
        : `run "yarn workspace dsh-plugin-desktop rebuild:native" — ${probe.stderr?.split('\n')[0] ?? `exit ${String(probe.status)}`}`,
    )
  }

  mkdirSync(join(home, 'canvas-studio'), { recursive: true })
  const prepared = prepareDesktopProfile('1', home, process.platform === 'win32' ? 'win32' : 'darwin')
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ).devDependencies.electron
  pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)

  let nativeThemeSource
  const trayItems = []
  const runtime = {
    platform: process.platform,
    windowsBuild: undefined,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: false,
      currentVersion: '2.0.0',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('plugin probe must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule(spec) { return async () => { void spec } },
    async mountScheduled() {},
    show() {},
    registerTrayItem(item) {
      trayItems.push(item)
      return { refresh() {}, dispose() {} }
    },
    openTerminal() {},
    setLocalePreference(preference) { runtime.locale = preference ?? 'en' },
    setThemeSource(source) { nativeThemeSource = source; void nativeThemeSource },
    async requestRestart() {},
    prepareToQuit() {},
  }

  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    prepared.patches,
    async (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopBrowserAccess', BROWSER_ACCESS)
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'desktop',
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)),
      })
      await host.plugin(DesktopProfileService, {
        current: { name: 'desktop', dir: prepared.profile.dir },
        list: () => [{
          name: 'desktop',
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, {
        args: ['--host', '127.0.0.1', '--port', '0'],
        exit: () => {},
      })
    },
    prepared.bareModuleBaseUrl,
  )

  // 1. MemOS tools registered on ctx.tools
  const toolNames = new Set(ctx.tools.schemas().map(schema => schema.name))
  const memosMissing = MEMOS_TOOLS.filter(name => !toolNames.has(name))
  report(
    'memos tools registered on ctx.tools',
    memosMissing.length === 0,
    memosMissing.length === 0
      ? MEMOS_TOOLS.join(', ')
      : `missing: ${memosMissing.join(', ')}`,
  )

  // 2. Hybrid provider serves a real keyless search
  let searchDetail = ''
  let searchOk = false
  try {
    const result = await ctx.web.search(
      { query: 'deepseek harness', maxResults: 3 },
      AbortSignal.timeout(45_000),
    )
    searchOk = Array.isArray(result.sources) && result.sources.length > 0
    searchDetail = `${result.sources.length} sources, first: ${result.sources[0]?.url ?? '(none)'}`
  } catch (error) {
    searchDetail = error instanceof Error ? error.message : String(error)
  }
  report('hybrid keyless search returns results', searchOk, searchDetail)

  // 3. Hybrid provider serves a real keyless fetch
  let fetchDetail = ''
  let fetchOk = false
  try {
    const fetched = await ctx.web.fetch({ url: 'https://example.com' }, AbortSignal.timeout(20_000))
    fetchOk = fetched.statusCode === 200 && fetched.body.kind === 'html'
    fetchDetail = `HTTP ${fetched.statusCode}, ${fetched.body.kind}, ${fetched.body.content.length} chars`
  } catch (error) {
    fetchDetail = error instanceof Error ? error.message : String(error)
  }
  report('hybrid keyless fetch returns page body', fetchOk, fetchDetail)

  // 4. MemOS runtime data directory materialized under $DSH_HOME
  const memosDataDir = join(home, 'memos-plugin', 'data')
  report(
    'memos runtime data directory created',
    existsSync(memosDataDir),
    memosDataDir,
  )
} catch (error) {
  report('probe boot completed', false, error instanceof Error ? error.message : String(error))
} finally {
  await ctx?.fiber.dispose()
  releasePackageResolver?.()
  pnpmRuntime?.dispose()
  rmSync(home, { recursive: true, force: true })
}

const failed = results.filter(entry => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
