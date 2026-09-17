/**
 * Guard `build.mac.x64ArchFiles` against every architecture-specific binary the
 * app actually ships.
 *
 * `@electron/universal` compares the x64 and arm64 slices file by file and
 * aborts when a Mach-O file has the same SHA in both and no `x64ArchFiles`
 * alternative covers it. That shape means one slice carries the other CPU's
 * binary, which is legitimate when the tree is named after that CPU: the
 * per-architecture sibling packages `supportedArchitectures` installs side by
 * side, a package's nested `prebuilds/<cpu>/`, a single package that nests one
 * directory per platform such as `onnxruntime-node/bin/napi-v6/darwin/arm64/`,
 * and the bundled ffmpeg tree that `extraResources` copies verbatim into both
 * slices. Missing one fails the macOS build about ten minutes in, with a message
 * that never names the fix, so the walk below reads every production file and
 * recognises any of those layouts instead of assuming one.
 *
 * The module finds the files; the spec supplies the matcher `@electron/universal`
 * itself applies, so this guard predicts the real merge gate instead of a
 * lookalike.
 *
 * @module scripts/mac-x64arch
 */

import { relative, sep } from 'node:path'
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
  /** Every regular file below one directory; empty when it is absent. */
  readonly listFilesRecursively: (directory: string) => readonly string[]
}

/** Whether a package name marks an architecture-specific sibling package. */
export function isArchitectureSpecificPackageName(name: string): boolean {
  return /darwin-(?:arm64|x64)$/u.test(name)
}

/**
 * Locate the Darwin CPU tree a package-relative path belongs to.
 *
 * Two segment shapes name one CPU's own tree: a single segment carrying the CPU
 * (`darwin-arm64`, as the sibling packages and their `prebuilds/` use), and a
 * `darwin` segment followed by the CPU segment (`darwin/arm64`, as
 * `onnxruntime-node` nests its per-platform binaries). Any other segment is
 * architecture-neutral, so a file under only such segments is merged by `lipo`
 * and must not be declared.
 * @param segments - Path segments of one file, relative to its package.
 * @returns The scope prefix through the CPU segment, or `undefined`.
 */
export function findArchitectureScope(segments: readonly string[]): string | undefined {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    if (isArchitectureSpecificPackageName(segment)) {
      return segments.slice(0, index + 1).join('/')
    }
    if (segment === 'darwin' && /^(?:arm64|x64)$/u.test(segments[index + 1] ?? '')) {
      return segments.slice(0, index + 2).join('/')
    }
  }
  return undefined
}

/** Interpret the leading bytes of a file. */
export function isMachOBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return MACH_O_MAGICS.has(view.getUint32(0, false)) || MACH_O_MAGICS.has(view.getUint32(0, true))
}

/** Build the path universal reports for a file inside one installed package. */
function appRelativePathOf(scopeName: string, segments: readonly string[]): string {
  return `${APP_RESOURCES_PREFIX}/app.asar.unpacked/node_modules/${[scopeName, ...segments].join('/')}`
}

/**
 * Collect the architecture-specific Mach-O files the packed app carries inside
 * `app.asar.unpacked`. A file counts when it is a Mach-O header underneath a tree
 * that names one Darwin CPU, because that exact pair is what
 * `@electron/universal` refuses to merge without an `x64ArchFiles` alternative.
 * The walk covers every file of every production package, so no nesting layout
 * has to be assumed.
 * @param options - Production packages and injected filesystem boundaries.
 * @returns One entry per matching file, deduplicated by reported path.
 */
export function collectArchSpecificNodeModulesFiles(
  options: ArchSpecificScanOptions,
): readonly ArchSpecificFile[] {
  const found = new Map<string, ArchSpecificFile>()
  for (const pkg of options.packages) {
    // A sibling package carries the CPU in its own name, so every Mach-O inside
    // it is slice-specific; in any other package the CPU must appear in the path.
    const packageOwnsCpu = isArchitectureSpecificPackageName(pkg.name)
    for (const file of options.listFilesRecursively(pkg.directory)) {
      const segments = relative(pkg.directory, file).split(sep)
      const marker = packageOwnsCpu ? pkg.name : findArchitectureScope(segments)
      if (marker === undefined) continue
      if (!options.isMachO(file)) continue
      const appRelativePath = appRelativePathOf(pkg.name, segments)
      const scope = packageOwnsCpu ? pkg.name : `${pkg.name}/${marker}`
      found.set(appRelativePath, { scope, appRelativePath })
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
