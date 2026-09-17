/**
 * Fetch the pinned bundled ffmpeg binaries and, optionally, install the host copy
 * into the unpackaged dev Electron bundle.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.ts            # host platform/architecture only
 *   node scripts/fetch-ffmpeg.ts --mac      # both darwin prebuilts (universal DMG)
 *   node scripts/fetch-ffmpeg.ts --win      # win32-x64
 *   node scripts/fetch-ffmpeg.ts --all      # every shipped target
 *   node scripts/fetch-ffmpeg.ts --dev      # also install into the dev Electron bundle
 *
 * The fetch is idempotent and content-pinned: an intact bundle is reused, so
 * repeated packaging runs stay offline. `--dev` is best-effort by design — a
 * developer without the mirror still falls back to a system ffmpeg — while the
 * packaging scripts run the fetch without `--dev` and fail loud.
 *
 * @module scripts/fetch-ffmpeg
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fetchFfmpegBundle,
  ffmpegBundleDir,
  ffmpegTarget,
  ffmpegTargetsForSelection,
  verifyBundledFfmpeg,
  type FfmpegTargetSelection,
} from './ffmpeg-bundle.ts'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Parse the packaging selection from argv, defaulting to the host machine. */
function parseSelection(argv: readonly string[]): FfmpegTargetSelection {
  const flags = new Set(argv.filter(argument => argument.startsWith('--')))
  const selections: FfmpegTargetSelection[] = []
  if (flags.has('--mac')) selections.push('mac')
  if (flags.has('--win')) selections.push('win')
  if (flags.has('--host')) selections.push('host')
  if (flags.has('--all')) selections.push('all')
  const unknown = [...flags].filter(flag => !['--mac', '--win', '--host', '--all', '--dev'].includes(flag))
  if (unknown.length > 0) {
    throw new Error(`fetch-ffmpeg: unsupported flag(s): ${unknown.join(', ')}`)
  }
  if (selections.length > 1) {
    return 'all'
  }
  return selections[0] ?? 'host'
}

/** Locate the unpackaged Electron distribution used by dev launches. */
function locateDevElectronResources(): string | undefined {
  const require = createRequire(import.meta.url)
  let electronDist: string
  try {
    electronDist = dirname(require.resolve('electron/package.json'))
  } catch {
    return undefined
  }
  const candidates = process.platform === 'darwin'
    ? [join(electronDist, 'dist', 'Electron.app', 'Contents', 'Resources')]
    : [join(electronDist, 'dist', 'resources')]
  return candidates.find(candidate => existsSync(candidate))
}

/**
 * Mirror the host binary into the dev Electron bundle so `resourcesPath` resolves
 * it exactly like the packaged app does.
 * @returns Nothing; logs the outcome and never throws.
 */
function installDevBundle(bundleDir: string): void {
  const key = `${process.platform}-${process.arch}`
  const target = ffmpegTarget(key)
  if (target === undefined) {
    console.log(`fetch-ffmpeg: no bundled target for this host (${key}); skipping the dev install`)
    return
  }
  const resources = locateDevElectronResources()
  if (resources === undefined) {
    console.log('fetch-ffmpeg: the unpackaged Electron distribution is absent; skipping the dev install')
    return
  }
  const destination = join(resources, 'ffmpeg', key)
  mkdirSync(destination, { recursive: true })
  const source = join(bundleDir, key)
  for (const name of [target.binary, target.license]) {
    copyFileSync(join(source, name), join(destination, name))
  }
  chmodSync(join(destination, target.binary), 0o755)
  console.log(`fetch-ffmpeg: dev bundle ready at ${destination}`)
}

const argv = process.argv.slice(2)
try {
  const selection = parseSelection(argv)
  const keys = ffmpegTargetsForSelection(selection, process.platform, process.arch)
  const bundleDir = ffmpegBundleDir(desktopRoot)
  console.log(`fetch-ffmpeg: preparing ${keys.join(', ')} in ${bundleDir}`)
  await fetchFfmpegBundle({ bundleDir, keys })
  verifyBundledFfmpeg({ bundleDir, keys, platform: process.platform, arch: process.arch })
  if (argv.includes('--dev')) {
    installDevBundle(bundleDir)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
