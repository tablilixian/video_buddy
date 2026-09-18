/**
 * Guard `build.mac.x64ArchFiles` against the Mach-O files `@electron/universal`
 * compares across the two macOS slices.
 *
 * The merge rule is narrower than "per-CPU files need declaring". Universal walks
 * the x64 and the arm64 slice and, for every Mach-O it finds in both, compares
 * the SHA: a different SHA is merged with `lipo`, an identical SHA aborts the
 * build unless an `x64ArchFiles` alternative covers the path, and a file that is
 * already universal in both slices is skipped. Electron Builder copies the whole
 * installed dependency tree into both slices, so every Mach-O below
 * `app.asar.unpacked/node_modules` is identical by construction — whether or not
 * its path names a CPU. That is exactly how `better-sqlite3` reached CI: the
 * local-memory plugin installed one host-architecture addon at one fixed path.
 *
 * The walk therefore reports every thin Mach-O of the production closure and
 * exempts what universal exempts: files an `x64ArchFiles` alternative covers,
 * files the packaging prepare step turns universal, files that are already
 * universal, and generated host artifacts the packaging rules exclude.
 *
 * The module finds the files; the spec supplies the matcher and the Mach-O
 * classification `@electron/universal` itself applies, so this guard predicts the
 * real merge gate instead of a lookalike.
 *
 * @module scripts/mac-x64arch
 */

import { relative, sep } from 'node:path'
import { BETTER_SQLITE3_ADDON } from './better-sqlite3-addon.ts'
import type { FfmpegTarget } from './ffmpeg-bundle.ts'
import { FORBIDDEN_MACOS_UNIVERSAL_ENTRIES } from './mac-universal.ts'
import type { ProductionManifest } from './production-graph.ts'

/** Prefix every path reported by `@electron/universal` carries. */
export const APP_RESOURCES_PREFIX = 'Contents/Resources'

/** Prefix of the physical runtime tree inside the packaged application. */
export const UNPACKED_RUNTIME_PREFIX = `${APP_RESOURCES_PREFIX}/app.asar.unpacked`

/** Mach-O magic numbers: 64/32-bit thin headers first, then universal ones. */
const MACH_O_MAGICS = new Set([
  0xcffaedfe, 0xcefaedfe, 0xfeedface, 0xfeedfacf, 0xcafebabe, 0xbebafeca,
])

/** The subset of those magic numbers that means the file carries both CPUs. */
const UNIVERSAL_MAGICS = new Set([0xcafebabe, 0xbebafeca])

/**
 * Mach-O files the packaging prepare step turns universal instead of declaring.
 *
 * `better-sqlite3` loads its addon from one fixed path with no per-CPU dispatch,
 * so a sliced layout is impossible and the installed binary has to carry both
 * CPUs. Removing an entry here makes the guard demand an `x64ArchFiles`
 * alternative, which would ship the host-only binary to the other slice.
 */
export const PREPARED_UNIVERSAL_FILES = [
  `${UNPACKED_RUNTIME_PREFIX}/${BETTER_SQLITE3_ADDON}`,
] as const

/**
 * Generated host artifacts no slice carries, taken from the packaging rules that
 * exclude them. Universal never sees these, so declaring them would be noise.
 */
export const UNSHIPPED_UNIVERSAL_FILES = FORBIDDEN_MACOS_UNIVERSAL_ENTRIES.map(
  entry => `${UNPACKED_RUNTIME_PREFIX}/${entry}`,
)

/** One Mach-O file the universal merge compares across the two slices. */
export interface CrossSliceFile {
  /** Human-readable owner, used in failure messages. */
  readonly owner: string
  /** Path relative to the `.app` root, shaped exactly as universal reports it. */
  readonly appRelativePath: string
}

/** Injectable filesystem boundaries for {@link collectCrossSliceFiles}. */
export interface CrossSliceScanOptions {
  /** Packages in the production closure. */
  readonly packages: readonly ProductionManifest[]
  /** Whether a file's leading bytes are a thin (single-CPU) Mach-O header. */
  readonly isThinMachO: (file: string) => boolean
  /** Every regular file below one directory; empty when it is absent. */
  readonly listFilesRecursively: (directory: string) => readonly string[]
}

/**
 * Collect the thin Mach-O files the packed application carries inside
 * `app.asar.unpacked`, in the path shape `@electron/universal` reports.
 *
 * A file counts when it is a thin Mach-O, because that exact pair — one physical
 * binary copied into both slices, differing in nothing — is what universal
 * refuses to merge without an `x64ArchFiles` alternative.
 * @param options - Production packages and injected filesystem boundaries.
 * @returns One entry per matching file, deduplicated by reported path.
 */
export function collectCrossSliceFiles(
  options: CrossSliceScanOptions,
): readonly CrossSliceFile[] {
  const unshipped = new Set(UNSHIPPED_UNIVERSAL_FILES)
  const found = new Map<string, CrossSliceFile>()
  for (const pkg of options.packages) {
    for (const file of options.listFilesRecursively(pkg.directory)) {
      const inside = relative(pkg.directory, file).split(sep).join('/')
      const appRelativePath = `${UNPACKED_RUNTIME_PREFIX}/node_modules/${pkg.name}/${inside}`
      if (unshipped.has(appRelativePath)) continue
      if (!options.isThinMachO(file)) continue
      found.set(appRelativePath, { owner: pkg.name, appRelativePath })
    }
  }
  return [...found.values()].sort((a, b) => a.appRelativePath.localeCompare(b.appRelativePath))
}

/** Whether a package name marks an architecture-specific sibling package. */
export function isArchitectureSpecificPackageName(name: string): boolean {
  return /darwin-(?:arm64|x64)$/u.test(name)
}

/** Read the leading four bytes as big-endian and little-endian magic numbers. */
function leadingMagics(bytes: Uint8Array): readonly number[] {
  if (bytes.byteLength < 4) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return [view.getUint32(0, false), view.getUint32(0, true)]
}

/** Interpret the leading bytes of a file as a Mach-O header of either kind. */
export function isMachOBytes(bytes: Uint8Array): boolean {
  return leadingMagics(bytes).some(magic => MACH_O_MAGICS.has(magic))
}

/** Interpret the leading bytes of a file as an already universal Mach-O header. */
export function isUniversalMachOBytes(bytes: Uint8Array): boolean {
  return leadingMagics(bytes).some(magic => UNIVERSAL_MAGICS.has(magic))
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
): readonly CrossSliceFile[] {
  const found: CrossSliceFile[] = []
  for (const target of options.targets) {
    if (!isArchitectureSpecificPackageName(target.key)) continue
    found.push({
      owner: `bundled ${target.key}`,
      appRelativePath: `${APP_RESOURCES_PREFIX}/${options.bundleTo}/${target.key}/${target.binary}`,
    })
  }
  return found
}

/** Injectable boundaries for {@link uncoveredCrossSliceFiles}. */
export interface CrossSliceCoverageOptions {
  /** Mach-O files that ship in both slices. */
  readonly files: readonly CrossSliceFile[]
  /** The configured `build.mac.x64ArchFiles` pattern. */
  readonly pattern: string | null | undefined
  /** Matcher applied exactly as `@electron/universal` applies it. */
  readonly matches: (path: string, pattern: string) => boolean
  /** Paths the packaging prepare step makes universal instead of declaring them. */
  readonly prepared: readonly string[]
}

/**
 * Report the Mach-O files `@electron/universal` would reject.
 * @param options - Discovered files, the checked-in pattern, and the matcher.
 * @returns Files no declaration covers and no preparation turns universal.
 */
export function uncoveredCrossSliceFiles(
  options: CrossSliceCoverageOptions,
): readonly CrossSliceFile[] {
  const prepared = new Set(options.prepared)
  const pattern = options.pattern
  if (pattern === null || pattern === undefined || pattern.length === 0) {
    return options.files.filter(file => !prepared.has(file.appRelativePath))
  }
  return options.files.filter(
    file => !prepared.has(file.appRelativePath)
      && !options.matches(file.appRelativePath, pattern),
  )
}

/**
 * Render one actionable failure line per uncovered file.
 * @param files - Files returned by {@link uncoveredCrossSliceFiles}.
 * @returns Lines naming each owner and the path that must be declared.
 */
export function describeUncoveredCrossSliceFiles(
  files: readonly CrossSliceFile[],
): readonly string[] {
  return files.map(
    file => `${file.owner}: add a build.mac.x64ArchFiles alternative covering ${file.appRelativePath}`,
  )
}
