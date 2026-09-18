/**
 * Make the installed `better-sqlite3` native addon universal before the macOS
 * merge.
 *
 * `@electron/universal` refuses to merge an x64 and an arm64 slice when a
 * Mach-O file has the same SHA in both and `x64ArchFiles` does not cover it.
 * Exactly that happens to a package whose addon lives at one fixed path and is
 * installed for the host CPU only: Electron Builder copies the whole installed
 * dependency tree into both slices, so both carry the same single-architecture
 * binary. Declaring the path in `x64ArchFiles` would silence the merge while
 * leaving the Intel slice with an Apple Silicon addon.
 *
 * `better-sqlite3` is a `dependencies` of the local-memory plugin and loads its
 * addon through one path with no per-CPU runtime dispatch, so the fix cannot be
 * a per-architecture layout: the addon itself has to carry both CPUs. This
 * module fetches the missing CPU's prebuilt binary with the same
 * `prebuild-install` the package install uses, joins both slices with `lipo`,
 * and proves the merged addon loads before the merge ever runs.
 *
 * @module scripts/better-sqlite3-addon
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Installed package that owns the addon, relative to the desktop root. */
export const BETTER_SQLITE3_PACKAGE = 'node_modules/better-sqlite3'

/** Addon path `better-sqlite3` loads, relative to the desktop root. */
export const BETTER_SQLITE3_ADDON = `${BETTER_SQLITE3_PACKAGE}/build/Release/better_sqlite3.node`

/** Prebuild installer entry point that resolves one CPU's prebuilt binary. */
const PREBUILD_INSTALL_ENTRY = 'node_modules/prebuild-install/bin.js'

/** One CPU a universal macOS application carries, under both of its names. */
export interface UniversalAddonArch {
  /** CPU name Node, `prebuild-install`, and every npm prebuild filename use. */
  readonly nodeArch: 'arm64' | 'x64'
  /** CPU name `lipo -archs` prints. */
  readonly lipoArch: string
}

/** Both CPUs a universal macOS application carries. */
export const UNIVERSAL_ADDON_ARCHES: readonly UniversalAddonArch[] = [
  { nodeArch: 'arm64', lipoArch: 'arm64' },
  { nodeArch: 'x64', lipoArch: 'x86_64' },
]

/** Result of one {@link ensureUniversalAddon} run. */
export type UniversalAddonOutcome = 'absent' | 'already-universal' | 'universalized'

/** Injectable process, filesystem, and command boundaries. */
export interface UniversalAddonOptions {
  /** Desktop package root containing `node_modules`. */
  readonly desktopRoot: string
  /** Node executable used to run `prebuild-install` and the load probe. */
  readonly nodeExecutable: string
  /** CPU architectures a Mach-O file carries; empty when it is missing or not Mach-O. */
  readonly archesOf: (file: string) => readonly string[]
  /** Create one directory, including parents. */
  readonly makeDirectory: (path: string) => void
  /** Copy one file, replacing the destination. */
  readonly copyFile: (from: string, to: string) => void
  /** Create an empty temporary directory and return its absolute path. */
  readonly makeScratchDirectory: () => string
  /** Remove a directory tree, ignoring a missing one. */
  readonly removeDirectory: (path: string) => void
  /** Execute one command, inheriting stdout and stderr. */
  readonly run: (file: string, args: readonly string[], cwd: string) => void
  /** Report non-secret progress. */
  readonly log: (message: string) => void
}

/** Report the CPUs a Mach-O file carries, tolerating a missing or foreign file. */
function readArches(options: UniversalAddonOptions, file: string): readonly string[] {
  try {
    return options.archesOf(file)
  } catch {
    return []
  }
}

/**
 * Produce the universal `better-sqlite3` addon both macOS slices share.
 *
 * The step is idempotent and stays offline when the addon already carries both
 * CPUs: it only reaches the network for the CPU the installed build lacks. The
 * merged file replaces the installed addon, so the two Electron Builder slices
 * copy one universal binary and `@electron/universal` skips it exactly as it
 * skips every other pre-merged Mach-O.
 * @param options - Injectable process, filesystem, and command boundaries.
 * @returns What the run did, for logging and focused tests.
 * @throws When the installed addon cannot be read as Mach-O, a slice cannot be
 * obtained, or the merged addon neither carries both CPUs nor loads.
 */
export function ensureUniversalAddon(options: UniversalAddonOptions): UniversalAddonOutcome {
  const packageDirectory = join(options.desktopRoot, BETTER_SQLITE3_PACKAGE)
  const addonPath = join(options.desktopRoot, BETTER_SQLITE3_ADDON)
  const installed = readArches(options, addonPath)
  if (installed.length === 0) {
    options.log(
      `better-sqlite3: no readable addon at ${addonPath}; skipping the universal prepare`,
    )
    return 'absent'
  }

  const missing = UNIVERSAL_ADDON_ARCHES.filter(arch => !installed.includes(arch.lipoArch))
  if (missing.length === 0) {
    options.log(
      `better-sqlite3: addon already carries ${UNIVERSAL_ADDON_ARCHES.map(arch => arch.lipoArch).join(' and ')}`,
    )
    return 'already-universal'
  }

  const scratch = options.makeScratchDirectory()
  try {
    const seedDirectory = join(scratch, BETTER_SQLITE3_PACKAGE)
    options.makeDirectory(seedDirectory)
    options.copyFile(
      join(packageDirectory, 'package.json'),
      join(seedDirectory, 'package.json'),
    )

    const slices: string[] = []
    for (const arch of UNIVERSAL_ADDON_ARCHES) {
      const slice = join(scratch, `better_sqlite3.${arch.lipoArch}.node`)
      if (missing.includes(arch)) {
        options.run(
          options.nodeExecutable,
          [
            join(options.desktopRoot, PREBUILD_INSTALL_ENTRY),
            '--platform=darwin',
            `--arch=${arch.nodeArch}`,
            '--force',
          ],
          seedDirectory,
        )
        options.copyFile(
          join(seedDirectory, 'build', 'Release', 'better_sqlite3.node'),
          slice,
        )
      } else {
        options.copyFile(addonPath, slice)
      }
      if (readArches(options, slice).length === 0) {
        throw new Error(
          `better-sqlite3: the ${arch.lipoArch} slice is not a readable Mach-O at ${slice}`,
        )
      }
      slices.push(slice)
    }

    const merged = join(scratch, 'better_sqlite3.universal.node')
    options.run('lipo', ['-create', ...slices, '-output', merged], scratch)
    options.copyFile(merged, addonPath)

    const mergedArches = readArches(options, addonPath)
    const absent = UNIVERSAL_ADDON_ARCHES.filter(arch => !mergedArches.includes(arch.lipoArch))
    if (absent.length > 0) {
      throw new Error(
        `better-sqlite3: ${addonPath} is missing ${absent.map(arch => arch.lipoArch).join(', ')} after lipo;`
        + ` received ${mergedArches.join(', ') || 'no readable CPU list'}`,
      )
    }
    options.run(
      options.nodeExecutable,
      ['-e', `require(${JSON.stringify(addonPath)})`],
      options.desktopRoot,
    )
    options.log(
      `better-sqlite3: joined ${String(slices.length)} slices into a universal addon carrying `
      + UNIVERSAL_ADDON_ARCHES.map(arch => arch.lipoArch).join(' and '),
    )
    return 'universalized'
  } finally {
    options.removeDirectory(scratch)
  }
}

/**
 * Read the CPUs a Mach-O file carries through `lipo`, the same tool
 * `@electron/universal` merges with.
 * @param file - Absolute path to a Mach-O file.
 * @returns CPU names as `lipo` prints them, in an implementation-defined order.
 * @throws When `lipo` cannot read the file.
 */
export function readMachOArchitectures(file: string): readonly string[] {
  const output = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' })
  return output.trim().split(/\s+/u).filter(arch => arch.length > 0)
}

/** Create the process, filesystem, and command boundaries of a real run. */
export function installedUniversalAddonOptions(
  desktopRoot: string,
): UniversalAddonOptions {
  return {
    desktopRoot,
    nodeExecutable: process.execPath,
    archesOf: readMachOArchitectures,
    makeDirectory: path => mkdirSync(path, { recursive: true }),
    copyFile: (from, to) => cpSync(from, to),
    makeScratchDirectory: () => mkdtempSync(join(tmpdir(), 'better-sqlite3-universal-')),
    removeDirectory: path => rmSync(path, { recursive: true, force: true }),
    run: (file, args, cwd) => {
      execFileSync(file, [...args], { cwd, stdio: 'inherit' })
    },
    log: message => console.log(message),
  }
}

/**
 * Prepare the installed `better-sqlite3` addon for the universal merge.
 * @param desktopRoot - Desktop package root containing `node_modules`.
 */
export function prepareInstalledUniversalAddon(desktopRoot: string): void {
  ensureUniversalAddon(installedUniversalAddonOptions(desktopRoot))
}
