/**
 * Guard `build.mac.x64ArchFiles` against every architecture-specific binary the
 * app actually ships.
 *
 * `@electron/universal` refuses to merge the x64 and arm64 slices when a Mach-O
 * file is byte-identical in both and no `x64ArchFiles` alternative covers it.
 * That shape normally means one slice carries the other architecture's binary,
 * which is legitimate only for per-architecture siblings such as
 * `@img/sharp-darwin-arm64`. Every single-tree source lands in the app that way:
 * the architecture-specific npm packages that `supportedArchitectures` installs
 * side by side, their in-package `prebuilds/`, and the bundled ffmpeg tree that
 * `extraResources` copies verbatim into both slices. Missing one fails the
 * macOS build about ten minutes in, with a message that never names the fix.
 *
 * The module finds the files; the spec supplies the matcher `@electron/universal`
 * itself applies, so this guard predicts the real merge gate instead of a
 * lookalike.
 *
 * @module scripts/mac-x64arch
 */

import { join, relative, sep } from 'node:path'
import type { FfmpegTarget } from './ffmpeg-bundle.ts'
import type { ProductionManifest } from './production-graph.ts'

/** Prefix every path reported by `@electron/universal` carries. */
export const APP_RESOURCES_PREFIX = 'Contents/Resources'

/** Mach-O magic numbers: 64/32-bit in both endiannesses, plus fat headers. */
const MACH_O_MAGICS = new Set([
  0xcffaedfe, 0xcefaedfe, 0xfeedface, 0xfeedfacf, 0xcafebabe, 0xbebafeca,
])

/** One architecture-specific file and the tree that owns it. */
export interface ArchSpecificFile {
  /** Human-readable owner, used in failure messages. */
  readonly scope: string
  /** Path relative to the `.app` root, shaped exactly as universal reports it. */
  readonly appRelativePath: string
}

/** Injectable filesystem boundaries for {@link collectArchSpecificNodeModulesFiles}. */
export interface ArchSpecificScanOptions {
  /** Packages in the production closure. */
  readonly packages: readonly ProductionManifest[]
  /** Whether a file's leading bytes are a Mach-O header. */
  readonly isMachO: (file: string) => boolean
  /** Immediate subdirectory names of one directory; empty when it is absent. */
  readonly listDirectories: (directory: string) => readonly string[]
  /** Every regular file below one directory; empty when it is absent. */
  readonly listFilesRecursively: (directory: string) => readonly string[]
}

/** Whether a package name marks an architecture-specific sibling package. */
export function isArchitectureSpecificPackageName(name: string): boolean {
  return /darwin-(?:arm64|x64)$/u.test(name)
}

/** Interpret the leading bytes of a file. */
export function isMachOBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return MACH_O_MAGICS.has(view.getUint32(0, false)) || MACH_O_MAGICS.has(view.getUint32(0, true))
}

/** Build the path universal reports for a file inside one installed package. */
function appRelativePathOf(scopeName: string, packageDirectory: string, file: string): string {
  const inside = relative(packageDirectory, file).split(sep).join('/')
  return `${APP_RESOURCES_PREFIX}/app.asar.unpacked/node_modules/${scopeName}/${inside}`
}

/**
 * Collect the architecture-specific Mach-O files the packed app carries inside
 * `app.asar.unpacked`. Scoped per-architecture packages and the `prebuilds/`
 * directories that nest inside a package both ship from the single installed
 * tree, so both are collected.
 * @param options - Production packages and injected filesystem boundaries.
 * @returns One entry per matching file, deduplicated by reported path.
 */
export function collectArchSpecificNodeModulesFiles(
  options: ArchSpecificScanOptions,
): readonly ArchSpecificFile[] {
  const found = new Map<string, ArchSpecificFile>()
  for (const pkg of options.packages) {
    const trees: Array<{ scope: string; directory: string }> = []
    if (isArchitectureSpecificPackageName(pkg.name)) {
      trees.push({ scope: pkg.name, directory: pkg.directory })
    }
    const prebuilds = join(pkg.directory, 'prebuilds')
    for (const name of options.listDirectories(prebuilds)) {
      if (!isArchitectureSpecificPackageName(name)) continue
      trees.push({ scope: `${pkg.name}/prebuilds/${name}`, directory: join(prebuilds, name) })
    }
    for (const tree of trees) {
      for (const file of options.listFilesRecursively(tree.directory)) {
        if (!options.isMachO(file)) continue
        const appRelativePath = appRelativePathOf(pkg.name, pkg.directory, file)
        found.set(appRelativePath, { scope: tree.scope, appRelativePath })
      }
    }
  }
  return [...found.values()].sort((a, b) => a.appRelativePath.localeCompare(b.appRelativePath))
}

/** Injectable boundaries for {@link collectArchSpecificBundledFiles}. */
export interface ArchSpecificBundleOptions {
  /** Destination directory inside the resources root, from `extraResources`. */
  readonly bundleTo: string
  /** Bundled ffmpeg targets the macOS application carries. */
  readonly targets: readonly FfmpegTarget[]
}

/**
 * Collect the bundled executables that `extraResources` copies verbatim into
 * both slices. Only per-architecture targets are slice-specific; a monolithic
 * target would be merged by `lipo` instead and must not be declared here.
 *
 * This is derived from configuration rather than from the built tree on
 * purpose: the coverage gate runs before packaging fetches the binaries, so
 * probing the build output would silently check nothing.
 * @param options - Bundle destination and the targets the platform ships.
 * @returns One entry per slice-specific bundled binary.
 */
export function collectArchSpecificBundledFiles(
  options: ArchSpecificBundleOptions,
): readonly ArchSpecificFile[] {
  const found: ArchSpecificFile[] = []
  for (const target of options.targets) {
    if (!isArchitectureSpecificPackageName(target.key)) continue
    found.push({
      scope: `bundled ${target.key}`,
      appRelativePath: `${APP_RESOURCES_PREFIX}/${options.bundleTo}/${target.key}/${target.binary}`,
    })
  }
  return found
}

/** Injectable boundaries for {@link uncoveredArchSpecificFiles}. */
export interface ArchSpecificCoverageOptions {
  /** Files that ship with an architecture-specific path. */
  readonly files: readonly ArchSpecificFile[]
  /** The configured `build.mac.x64ArchFiles` pattern. */
  readonly pattern: string | null | undefined
  /** Matcher applied exactly as `@electron/universal` applies it. */
  readonly matches: (path: string, pattern: string) => boolean
}

/**
 * Report the architecture-specific files `@electron/universal` would reject.
 * @param options - Discovered files, the checked-in pattern, and the matcher.
 * @returns Files no `x64ArchFiles` alternative covers, in report order.
 */
export function uncoveredArchSpecificFiles(
  options: ArchSpecificCoverageOptions,
): readonly ArchSpecificFile[] {
  const pattern = options.pattern
  if (pattern === null || pattern === undefined || pattern.length === 0) return [...options.files]
  return options.files.filter(file => !options.matches(file.appRelativePath, pattern))
}

/**
 * Render one actionable failure line per uncovered file.
 * @param files - Files returned by {@link uncoveredArchSpecificFiles}.
 * @returns Lines naming each owner and the path that must be declared.
 */
export function describeUncoveredArchSpecificFiles(
  files: readonly ArchSpecificFile[],
): readonly string[] {
  return files.map(file => `${file.scope}: add a build.mac.x64ArchFiles alternative covering ${file.appRelativePath}`)
}
